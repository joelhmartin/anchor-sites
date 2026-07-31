import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../db/seed.js";
import { sitemapRouter } from "../../src/server/routes/sitemap.js";
import { createPost } from "../../src/server/blog/repo.js";
import { createEvent } from "../../src/server/events/repo.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const HOST = "muldoon-dental.sites.anchorcorps.com";
const BODY = [{ id: "r1", type: "rich-text", props: { html: "<p>b</p>" } }];

function buildApp(pool: Pool): express.Express {
  const app = express();
  app.use(sitemapRouter({ pool }));
  app.use((_req, res) => res.status(200).type("text/plain").send("DOWNSTREAM"));
  return app;
}

d("sitemap + robots (P9-T9.5/9.6)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;

  beforeAll(async () => {
    await migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction: "up", count: Infinity, log: () => undefined });
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug = 'muldoon-dental'`);
    siteId = r.rows[0].id;
    await pool.query(`DELETE FROM posts WHERE site_id = $1 AND slug IN ('sm-pub','sm-noindex')`, [siteId]);
    await pool.query(`DELETE FROM events WHERE site_id = $1 AND slug = 'sm-event'`, [siteId]);
    await createPost(pool, siteId, { slug: "sm-pub", title: "Pub", body: BODY, status: "published" });
    await createPost(pool, siteId, { slug: "sm-noindex", title: "Hidden", body: BODY, status: "published", seo: { robots: { index: false, follow: true } } });
    await createEvent(pool, siteId, { slug: "sm-event", title: "Ev", description: BODY, starts_at: new Date("2026-08-01T00:00:00Z"), status: "published" });
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM posts WHERE site_id = $1 AND slug IN ('sm-pub','sm-noindex')`, [siteId]).catch(() => undefined);
    await pool.query(`DELETE FROM events WHERE site_id = $1 AND slug = 'sm-event'`, [siteId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => __clearResolveSiteCacheForTests());

  it("serves a valid XML sitemap listing published pages, posts and events", async () => {
    const res = await request(app).get("/sitemap.xml").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/xml/);
    expect(res.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.text).toContain("<urlset");
    // home page collapses to "/"
    expect(res.text).toContain("<loc>https://muldoon-dental.sites.anchorcorps.com/</loc>");
    expect(res.text).toContain("<loc>https://muldoon-dental.sites.anchorcorps.com/blog</loc>");
    expect(res.text).toContain("<loc>https://muldoon-dental.sites.anchorcorps.com/blog/sm-pub</loc>");
    expect(res.text).toContain("<loc>https://muldoon-dental.sites.anchorcorps.com/events/sm-event</loc>");
  });

  it("D301: page <lastmod> reflects published_at, not draft-edit updated_at", async () => {
    // A draft edit bumps updated_at (touch trigger) but must not advertise
    // freshness for content that never shipped — pages' lastmod reads
    // published_at. Pin it to a known date and edit the working copy.
    await pool.query(
      `UPDATE pages SET published_at = '2026-01-05T12:00:00Z', title = title
        WHERE site_id = $1 AND slug = 'home'`,
      [siteId],
    );
    try {
      const res = await request(app).get("/sitemap.xml").set("Host", HOST);
      const homeEntry = res.text
        .split("\n")
        .find((l) => l.includes(">https://muldoon-dental.sites.anchorcorps.com/</loc>"));
      expect(homeEntry).toContain("<lastmod>2026-01-05</lastmod>");
    } finally {
      await pool.query(
        `UPDATE pages SET published_at = now() WHERE site_id = $1 AND slug = 'home'`,
        [siteId],
      );
    }
  });

  it("excludes robots.index=false content from the sitemap", async () => {
    const res = await request(app).get("/sitemap.xml").set("Host", HOST);
    expect(res.text).not.toContain("sm-noindex");
  });

  it("serves robots.txt pointing at the sitemap", async () => {
    const res = await request(app).get("/robots.txt").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("Sitemap: https://muldoon-dental.sites.anchorcorps.com/sitemap.xml");
    expect(res.text).toContain("User-agent: *");
  });

  // D908 — crawl surfaces tolerate short staleness; 5 minutes of caching cuts
  // repeated full-DB renders without meaningfully delaying crawlers.
  it("sitemap.xml + robots.txt declare a short public max-age (D908)", async () => {
    const sitemap = await request(app).get("/sitemap.xml").set("Host", HOST);
    expect(sitemap.headers["cache-control"]).toBe("public, max-age=300");
    const robots = await request(app).get("/robots.txt").set("Host", HOST);
    expect(robots.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("falls through (DOWNSTREAM) on the admin host", async () => {
    const res = await request(app).get("/sitemap.xml").set("Host", "studio.localhost");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("falls through on an unknown host", async () => {
    const res = await request(app).get("/robots.txt").set("Host", "nobody.example.com");
    expect(res.text).toBe("DOWNSTREAM");
  });
});
