import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { __clearResolveSiteCacheForTests, resolveSite } from "../../src/middleware/resolveSite.js";

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
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.use(resolveSite({ pool }));
  app.get("/whoami", (req, res) => res.status(200).json({ site: req.site }));
  return app;
}

d("resolveSite middleware (integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  it("resolves muldoon via explicit site_domains row", async () => {
    const res = await request(buildApp(pool))
      .get("/whoami")
      .set("Host", "muldoon.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.body.site.slug).toBe("muldoon-dental");
    expect(res.body.site.matched_via).toBe("domain");
    expect(res.body.site.plugins).toEqual([]);
    expect(res.body.site.default_brand_tokens).toMatchObject({ "--theme-main": "#0a3d62" });
  });

  it("resolves demo via explicit site_domains row", async () => {
    const res = await request(buildApp(pool))
      .get("/whoami")
      .set("Host", "demo.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.body.site.slug).toBe("demo-site");
    expect(res.body.site.matched_via).toBe("domain");
  });

  it("returns 404 for an unknown host", async () => {
    const res = await request(buildApp(pool))
      .get("/whoami")
      .set("Host", "nope.example.com");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Site not found/);
  });

  it("does not run middleware on routes mounted before it (/healthz)", async () => {
    const res = await request(buildApp(pool)).get("/healthz").set("Host", "nope.example.com");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("strips the port from the Host header before lookup", async () => {
    const res = await request(buildApp(pool))
      .get("/whoami")
      .set("Host", "muldoon.sites.anchorcorps.com:8080");
    expect(res.status).toBe(200);
    expect(res.body.site.slug).toBe("muldoon-dental");
  });

  it("falls back to subdomain → sites.slug when no site_domains row matches", async () => {
    // Insert a site with a unique slug but no site_domains row.
    const slug = `fallback-${Date.now().toString(36)}`;
    await pool.query(
      `INSERT INTO sites (slug, display_name) VALUES ($1, $2)`,
      [slug, "Subdomain Fallback Test"],
    );
    try {
      const res = await request(buildApp(pool))
        .get("/whoami")
        .set("Host", `${slug}.sites.anchorcorps.com`);
      expect(res.status).toBe(200);
      expect(res.body.site.slug).toBe(slug);
      expect(res.body.site.matched_via).toBe("subdomain");
    } finally {
      await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]);
    }
  });

  it("memoizes the lookup for 60s (no DB call on second hit)", async () => {
    let queryCount = 0;
    const spyPool = {
      query: (...args: unknown[]) => {
        queryCount++;
        return pool.query(...(args as Parameters<Pool["query"]>));
      },
    } as unknown as Pool;

    const app = express();
    app.use(resolveSite({ pool: spyPool }));
    app.get("/whoami", (req, res) => res.json({ slug: req.site?.slug }));

    const r1 = await request(app)
      .get("/whoami")
      .set("Host", "muldoon.sites.anchorcorps.com");
    expect(r1.status).toBe(200);
    expect(queryCount).toBe(1);

    const r2 = await request(app)
      .get("/whoami")
      .set("Host", "muldoon.sites.anchorcorps.com");
    expect(r2.status).toBe(200);
    expect(queryCount).toBe(1); // cache hit, no new query
  });

  it("passThroughOnMiss: unknown host calls next() instead of 404", async () => {
    const app = express();
    app.use(resolveSite({ pool, passThroughOnMiss: true }));
    // Downstream handler that runs only if middleware called next() without responding.
    app.get("/whoami", (req, res) =>
      res.status(200).json({ site: req.site ?? null, downstream: true }),
    );

    const res = await request(app).get("/whoami").set("Host", "nope.example.com");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ site: null, downstream: true });
  });

  it("caches negative lookups too (404 host → no repeat query)", async () => {
    let queryCount = 0;
    const spyPool = {
      query: (...args: unknown[]) => {
        queryCount++;
        return pool.query(...(args as Parameters<Pool["query"]>));
      },
    } as unknown as Pool;

    const app = express();
    app.use(resolveSite({ pool: spyPool }));
    app.get("/whoami", (_req, res) => res.json({}));

    const r1 = await request(app).get("/whoami").set("Host", "ghost.example.com");
    expect(r1.status).toBe(404);
    // First miss may execute one or two queries depending on subdomain regex match.
    const afterFirst = queryCount;

    const r2 = await request(app).get("/whoami").set("Host", "ghost.example.com");
    expect(r2.status).toBe(404);
    expect(queryCount).toBe(afterFirst); // cached negative — no new queries
  });
});
