import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { createApp } from "../../src/server/app.js";
import { pool as appPool } from "../../src/server/db.js";
import { createTemplate } from "../../src/server/templates/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-app-route-order";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

// These tests go through the REAL composed app (createApp()), unlike the
// per-router integration suites that mount a single router at /api. Route
// shadowing between routers (D100) is only observable here: with
// adminPagesRouter mounted before templatesRouter, its param route
// `POST /sites/:siteId/pages/:pageId` swallowed the literal
// `POST /sites/:siteId/pages/from-template` and 400'd "invalid payload".
d("createApp() /api route composition (D100)", () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let siteId: string;
  let scratchPageId: string;
  let pageTemplateId: string;

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // then guarantees this resets before the next test anywhere in the suite
  // (see .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  beforeAll(async () => {
    await migrate({
      databaseUrl: TEST_DB_URL!,
      dir: MIGRATIONS_DIR,
      migrationsTable: "pgmigrations",
      direction: "up",
      count: Infinity,
      log: () => undefined,
    });
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);

    const site = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'muldoon-dental'`,
    );
    siteId = site.rows[0].id;

    // A scratch page of our own so the save-route assertion below never
    // mutates seeded pages other files depend on.
    const scratch = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'approuteorder-scratch', 'Scratch', '[]'::jsonb, '{}'::jsonb, 'draft')
       RETURNING id`,
      [siteId],
    );
    scratchPageId = scratch.rows[0].id;

    const tpl = await createTemplate(
      {
        slug: "approuteorder-snippet",
        name: "Route Order Snippet",
        kind: "page",
        pages: [
          {
            slug: "approuteorder-promo",
            title: "Promo",
            blocks: [{ id: "r1", type: "rich-text", props: { html: "<p>Promo</p>" } }],
            seo: {},
          },
        ],
      },
      { pool },
    );
    pageTemplateId = tpl.template.id;

    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'approuteorder-%'`).catch(() => undefined);
    await pool
      .query(`DELETE FROM pages WHERE site_id = $1 AND slug LIKE 'approuteorder-%'`, [siteId])
      .catch(() => undefined);
    await pool.end().catch(() => undefined);
    await appPool.end().catch(() => undefined);
  });

  it("POST /api/sites/:siteId/pages/from-template reaches the templates handler", async () => {
    const res = await auth(request(app).post(`/api/sites/${siteId}/pages/from-template`)).send({
      template_id: pageTemplateId,
    });
    expect(res.status).toBe(201);
    expect(res.body.page).toMatchObject({
      site_id: siteId,
      slug: "approuteorder-promo",
      title: "Promo",
      status: "draft",
    });
  });

  it("POST /api/sites/:siteId/pages/:pageId still reaches the admin-pages save handler (no reverse shadowing)", async () => {
    const res = await auth(request(app).post(`/api/sites/${siteId}/pages/${scratchPageId}`)).send({
      blocks: [{ id: "b1", type: "rich-text", props: { html: "<p>Saved</p>" } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({ id: scratchPageId, site_id: siteId });
    expect(res.body.revision?.id).toBeTruthy();
  });
});
