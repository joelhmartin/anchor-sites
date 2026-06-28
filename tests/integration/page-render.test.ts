import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { pageRouter } from "../../src/server/routes/page.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

function buildApp(pool: Pool): express.Express {
  const app = express();
  app.use(pageRouter({ pool }));
  // Downstream fallback — mimics Vite/SPA in dev. Should only be reached
  // when resolveSite passes through on an unknown host.
  app.use((_req, res) => res.status(200).type("text/plain").send("DOWNSTREAM"));
  return app;
}

d("page renderer catch-all (integration)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  it("muldoon home renders with seeded hero text + SEO meta", async () => {
    const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Modern dental care, gentle hands.");
    expect(res.text).toContain("ac-hero");
    expect(res.text).toContain("ac-rich-text");
    expect(res.text).toContain("ac-cta");
    // SEO from pages.seo
    expect(res.text).toMatch(/<title>Muldoon Dental — Family \+ Cosmetic Dentistry<\/title>/);
    expect(res.text).toMatch(
      /<meta name="description" content="Family and cosmetic dentistry [^"]*"/,
    );
    // data-site-slug on <html>
    expect(res.text).toMatch(/data-site-slug="muldoon-dental"/);
    // Brand tokens injected
    expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
    // P9-T9.2 — SEO head: canonical + robots + OG wired through renderPage
    expect(res.text).toContain(
      '<link rel="canonical" href="https://muldoon-dental.sites.anchorcorps.com/" />',
    );
    expect(res.text).toContain('<meta name="robots" content="index,follow" />');
    expect(res.text).toContain('<meta property="og:type" content="website" />');
  });

  it("demo home renders different content + different brand tokens", async () => {
    const res = await request(app).get("/").set("Host", "demo-site.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Same renderer. Different site.");
    expect(res.text).not.toContain("Modern dental care, gentle hands.");
    expect(res.text).toMatch(/--theme-main:\s*#1f1f1f/);
    expect(res.text).toMatch(/data-site-slug="demo-site"/);
  });

  it("returns 404 (site-shelled) for an unknown slug on a known site", async () => {
    const res = await request(app)
      .get("/this-page-does-not-exist")
      .set("Host", "muldoon-dental.sites.anchorcorps.com");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Page not found/);
    // 404 still wears the site's brand
    expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
    // P9-T9.2 — a 404 must be noindex
    expect(res.text).toContain('<meta name="robots" content="noindex" />');
  });

  it("passes through to downstream when host is unknown (Vite/SPA fallback)", async () => {
    const res = await request(app).get("/").set("Host", "nope.example.com");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("admin host (studio.localhost) passes through to the SPA, never 404s as a tenant (P4-T4.1)", async () => {
    const res = await request(app).get("/sites").set("Host", "studio.localhost");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("brand tokens differ between the two sites' rendered CSS", async () => {
    const m = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
    const d = await request(app).get("/").set("Host", "demo-site.sites.anchorcorps.com");
    const mTokens = m.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    const dTokens = d.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    expect(mTokens).toBe("#0a3d62");
    expect(dTokens).toBe("#1f1f1f");
    expect(mTokens).not.toBe(dTokens);
  });

  it("brand_tokens_override on a page wins per-key over the site default (P3-T3.5)", async () => {
    await pool.query(
      `UPDATE pages
          SET brand_tokens_override = $1::jsonb
        WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental')
          AND slug = 'home'`,
      [JSON.stringify({ "--theme-main": "#ff00aa" })],
    );
    try {
      const r = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(r.status).toBe(200);
      // Sanity: peek at the :root block of the SSR'd <style> tag.
      const rootBlock = r.text.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "(:root not found)";
      // Override wins for --theme-main.
      expect(rootBlock).toMatch(/--theme-main:\s*#ff00aa\s*;/);
      // Non-overridden site default still passes through (--theme-accent unchanged).
      expect(r.text).toMatch(/--theme-accent:\s*#f6b93b\s*;/);
    } finally {
      await pool.query(
        `UPDATE pages SET brand_tokens_override = NULL
          WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental')
            AND slug = 'home'`,
      );
    }
  });

  it("media hydration: <picture> srcset + width/height land in HTML when an Image block references a ready media_asset (P3-T3.14)", async () => {
    // Fixture asset that pretends 3.10's variant job already finished.
    const muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    const variants = [
      { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      { name: "md", format: "webp", width: 768, height: 432, url: "https://x/md.webp" },
      { name: "sm", format: "jpg", width: 480, height: 270, url: "https://x/sm.jpg" },
      { name: "md", format: "jpg", width: 768, height: 432, url: "https://x/md.jpg" },
    ];
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status, variants, width, height)
       VALUES ($1, $2, 'image/png', 'Fixture image', 'ready', $3::jsonb, 1280, 720) RETURNING id`,
      [muldoonId, `originals/${muldoonId}/hydration-fixture.png`, JSON.stringify(variants)],
    );
    const assetId = ins.rows[0].id;
    // Snapshot the muldoon home blocks so we can restore later.
    const before = await pool.query<{ blocks: unknown[] }>(
      `SELECT blocks FROM pages WHERE site_id = $1 AND slug = 'home'`,
      [muldoonId],
    );
    const originalBlocks = before.rows[0].blocks;
    try {
      const newBlocks = [
        ...originalBlocks,
        { id: "img-1", type: "image", props: { asset_id: assetId, alt: "Override alt" } },
      ];
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [JSON.stringify(newBlocks), muldoonId],
      );

      const r = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(r.status).toBe(200);
      expect(r.text).toContain("ac-image");
      // WebP source with sorted srcset
      expect(r.text).toMatch(
        /<source[^>]*type="image\/webp"[^>]*srcSet="https:\/\/x\/sm\.webp 480w, https:\/\/x\/md\.webp 768w"/i,
      );
      // JPG fallback uses the largest variant.
      expect(r.text).toMatch(/<img[^>]*src="https:\/\/x\/md\.jpg"/i);
      // Prop alt wins.
      expect(r.text).toMatch(/alt="Override alt"/);
      // Width/height hints landed.
      expect(r.text).toMatch(/width="1280"/);
      expect(r.text).toMatch(/height="720"/);
    } finally {
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [JSON.stringify(originalBlocks), muldoonId],
      );
      await pool.query(`DELETE FROM media_assets WHERE id = $1`, [assetId]);
    }
  });

  it("draft pages are not served", async () => {
    // flip muldoon home to draft, request it, then restore.
    await pool.query(
      `UPDATE pages SET status = 'draft' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
    );
    try {
      const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(404);
    } finally {
      await pool.query(
        `UPDATE pages SET status = 'published' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
      );
    }
  });
});
