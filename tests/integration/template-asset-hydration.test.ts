import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { createTemplate } from "../../src/server/templates/repo.js";
import { handleMaterializeTemplate } from "../../src/server/jobs/materialize-template.js";
import { pageRouter } from "../../src/server/routes/page.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

/**
 * W2-CONC / D1214 — template-materialize → tenant-render asset hydration.
 *
 * materialize-template promises "captured blocks keep their source
 * asset_ids … render from immutable URLs. No media copy" — but hydration
 * (`loadAssetsForBlocks`) used to filter strictly `WHERE site_id = <new
 * site>`, so any template that captured a real image rendered missing-asset
 * placeholders forever on materialized sites. This suite proves the whole
 * chain END TO END through the real tenant route: source site owns the
 * assets → template captures blocks referencing them (nav-bar logo +
 * split-hero image, the two fields D901's allowlist also missed) →
 * materialize into a fresh site → the LIVE render carries the variant URLs.
 * Tenant isolation stays intact: an asset owned by a random non-template
 * site does NOT hydrate.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const LOGO_URL = "https://media.example/d1214/logo-sm.webp";
const SPLIT_URL = "https://media.example/d1214/split-lg.jpg";
const FOREIGN_URL = "https://media.example/d1214/foreign.jpg";

async function insertReadyAsset(pool: Pool, siteId: string, key: string, url: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status, variants, width, height)
     VALUES ($1, $2, 'image/jpeg', 'D1214 fixture', 'ready', $3::jsonb, 1280, 720)
     RETURNING id`,
    [
      siteId,
      key,
      JSON.stringify([{ name: "lg", format: url.endsWith(".webp") ? "webp" : "jpg", width: 1280, height: 720, url }]),
    ],
  );
  return r.rows[0].id;
}

d("template-materialize → tenant-render asset hydration (D1214)", () => {
  let pool: Pool;
  let destSiteId: string;
  const HOST = "d1214-dest.sites.anchorcorps.com";

  beforeAll(async () => {
    await migrate({
      databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations",
      direction: "up", count: Infinity, log: () => undefined,
    });
    pool = new Pool({ connectionString: TEST_DB_URL });

    // 1. The template's SOURCE site owns the real, processed assets.
    const src = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('d1214-source', 'D1214 Source') RETURNING id`,
    );
    const srcSiteId = src.rows[0].id;
    const logoAssetId = await insertReadyAsset(
      pool, srcSiteId, `originals/${srcSiteId}/d1214-logo.webp`, LOGO_URL,
    );
    const splitAssetId = await insertReadyAsset(
      pool, srcSiteId, `originals/${srcSiteId}/d1214-split.jpg`, SPLIT_URL,
    );

    // 2. Capture a template from it — nav-bar logo + split-hero image are
    // exactly the two reference shapes D901's old allowlist missed.
    const { template } = await createTemplate(
      {
        slug: "d1214-template",
        name: "D1214 Template",
        kind: "site",
        source_site_id: srcSiteId,
        pages: [
          {
            slug: "home",
            title: "Home",
            blocks: [
              { id: "nav1", type: "nav-bar", props: { brand_name: "D1214", logo_asset_id: logoAssetId } },
              {
                id: "split1",
                type: "split-hero",
                props: { heading: "Captured imagery", image_asset_id: splitAssetId, image_alt: "Split" },
              },
            ],
            seo: {},
          },
        ],
      },
      { pool },
    );

    // 3. A fresh site + its public hostname, then materialize into it.
    const dest = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('d1214-dest', 'D1214 Dest') RETURNING id`,
    );
    destSiteId = dest.rows[0].id;
    await pool.query(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, true, 'verified', 'active')`,
      [destSiteId, HOST],
    );
    const result = await handleMaterializeTemplate(
      { siteId: destSiteId, templateId: template.id },
      { pool },
    );
    expect(result.pages_created).toBe(1);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM templates WHERE slug = 'd1214-template'`).catch(() => undefined);
    await pool
      .query(`DELETE FROM sites WHERE slug IN ('d1214-source', 'd1214-dest', 'd1214-foreign')`)
      .catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(pageRouter({ pool }));
    app.use((_req, res) => res.status(200).type("text/plain").send("DOWNSTREAM"));
    return app;
  }

  it("the materialized site's LIVE render resolves the template's nav logo and split-hero image", async () => {
    const res = await request(buildApp()).get("/").set("Host", HOST);
    expect(res.status).toBe(200);
    // Nav-bar logo resolved through MediaContext → the variant URL is in the HTML.
    expect(res.text).toContain("ac-nav-bar");
    expect(res.text).toContain(LOGO_URL);
    // Split-hero image resolved too — not the missing-asset placeholder.
    expect(res.text).toContain("ac-split-hero");
    expect(res.text).toContain(SPLIT_URL);
  });

  it("tenant isolation survives the widening: an asset owned by a NON-template site never hydrates", async () => {
    const foreign = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('d1214-foreign', 'D1214 Foreign') RETURNING id`,
    );
    const foreignAssetId = await insertReadyAsset(
      pool, foreign.rows[0].id, `originals/${foreign.rows[0].id}/d1214-foreign.jpg`, FOREIGN_URL,
    );

    // Append an image block referencing the foreign asset to the
    // materialized page, re-freeze the snapshot (the tenant route serves
    // published_snapshot, not the working columns — D301).
    await pool.query(
      `UPDATE pages
          SET blocks = blocks || $2::jsonb,
              published_snapshot = jsonb_set(
                published_snapshot, '{blocks}',
                (published_snapshot->'blocks') || $2::jsonb)
        WHERE site_id = $1 AND slug = 'home'`,
      [
        destSiteId,
        JSON.stringify([{ id: "foreign1", type: "image", props: { asset_id: foreignAssetId, alt: "F" } }]),
      ],
    );

    const res = await request(buildApp()).get("/").set("Host", HOST);
    expect(res.status).toBe(200);
    // Template-source assets still resolve…
    expect(res.text).toContain(LOGO_URL);
    // …but the foreign site's asset does not leak across tenants.
    expect(res.text).not.toContain(FOREIGN_URL);
  });
});
