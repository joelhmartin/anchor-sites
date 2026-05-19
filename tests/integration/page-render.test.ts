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
    const res = await request(app).get("/").set("Host", "muldoon.sites.anchorcorps.com");
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
  });

  it("demo home renders different content + different brand tokens", async () => {
    const res = await request(app).get("/").set("Host", "demo.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Same renderer. Different site.");
    expect(res.text).not.toContain("Modern dental care, gentle hands.");
    expect(res.text).toMatch(/--theme-main:\s*#1f1f1f/);
    expect(res.text).toMatch(/data-site-slug="demo-site"/);
  });

  it("returns 404 (site-shelled) for an unknown slug on a known site", async () => {
    const res = await request(app)
      .get("/this-page-does-not-exist")
      .set("Host", "muldoon.sites.anchorcorps.com");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Page not found/);
    // 404 still wears the site's brand
    expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
  });

  it("passes through to downstream when host is unknown (Vite/SPA fallback)", async () => {
    const res = await request(app).get("/").set("Host", "nope.example.com");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("brand tokens differ between the two sites' rendered CSS", async () => {
    const m = await request(app).get("/").set("Host", "muldoon.sites.anchorcorps.com");
    const d = await request(app).get("/").set("Host", "demo.sites.anchorcorps.com");
    const mTokens = m.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    const dTokens = d.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    expect(mTokens).toBe("#0a3d62");
    expect(dTokens).toBe("#1f1f1f");
    expect(mTokens).not.toBe(dTokens);
  });

  it("draft pages are not served", async () => {
    // flip muldoon home to draft, request it, then restore.
    await pool.query(
      `UPDATE pages SET status = 'draft' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
    );
    try {
      const res = await request(app).get("/").set("Host", "muldoon.sites.anchorcorps.com");
      expect(res.status).toBe(404);
    } finally {
      await pool.query(
        `UPDATE pages SET status = 'published' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
      );
    }
  });
});
