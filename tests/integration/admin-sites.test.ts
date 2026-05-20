import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../db/seed.js";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-sites";

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminSitesRouter({ pool }));
  return app;
}

d("admin sites API — GET /api/sites (P4-T4.2)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("401 without admin token", async () => {
    const r = await request(app).get("/api/sites");
    expect(r.status).toBe(401);
  });

  it("lists seeded sites with page counts, newest first", async () => {
    const r = await request(app).get("/api/sites").set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.sites)).toBe(true);
    const slugs = r.body.sites.map((s: { slug: string }) => s.slug);
    expect(slugs).toContain("muldoon-dental");
    expect(slugs).toContain("demo-site");

    const muldoon = r.body.sites.find((s: { slug: string }) => s.slug === "muldoon-dental");
    expect(muldoon).toMatchObject({
      slug: "muldoon-dental",
      display_name: expect.any(String),
      status: "active",
    });
    // muldoon home page is seeded → at least 1.
    expect(muldoon.pages_count).toBeGreaterThanOrEqual(1);
    expect(typeof muldoon.pages_count).toBe("number");
  });

  it("orders by created_at descending", async () => {
    const r = await request(app).get("/api/sites").set("X-Admin-Token", ADMIN_TOKEN);
    const times = r.body.sites.map((s: { created_at: string }) => new Date(s.created_at).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});

d("admin sites API — detail + pages (P4-T4.3)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("GET /api/sites/:id 401 without token", async () => {
    const r = await request(app).get(`/api/sites/${muldoonId}`);
    expect(r.status).toBe(401);
  });

  it("GET /api/sites/:id returns detail with counts + brand tokens", async () => {
    const r = await request(app).get(`/api/sites/${muldoonId}`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.site).toMatchObject({
      id: muldoonId,
      slug: "muldoon-dental",
      status: "active",
    });
    expect(r.body.site.default_brand_tokens).toMatchObject({ "--theme-main": "#0a3d62" });
    expect(typeof r.body.site.pages_count).toBe("number");
    expect(typeof r.body.site.media_count).toBe("number");
  });

  it("GET /api/sites/:id 404 for unknown site", async () => {
    const r = await request(app)
      .get(`/api/sites/00000000-0000-0000-0000-000000000000`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("GET /api/sites/:id/pages lists pages (updated_at desc)", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/pages`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.pages)).toBe(true);
    const home = r.body.pages.find((p: { slug: string }) => p.slug === "home");
    expect(home).toMatchObject({ slug: "home", status: "published" });
    expect(home.title).toBeTruthy();
  });

  it("GET /api/sites/:id/pages 404 for unknown site", async () => {
    const r = await request(app)
      .get(`/api/sites/00000000-0000-0000-0000-000000000000/pages`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });
});

d("admin sites API — media list (P4-T4.4)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    // Seed a few media rows.
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status)
         VALUES ($1, $2, 'image/png', $3, $4)`,
        [muldoonId, `originals/${muldoonId}/m${i}-${Date.now()}.png`, `alt ${i}`, i === 0 ? "ready" : "pending"],
      );
    }
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM media_assets WHERE site_id = $1`, [muldoonId]).catch(() => {});
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("401 without token", async () => {
    const r = await request(app).get(`/api/sites/${muldoonId}/media`);
    expect(r.status).toBe(401);
  });

  it("lists media newest-first with total + ready and pending rows", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/media`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(3);
    expect(r.body.media.length).toBeGreaterThanOrEqual(3);
    const statuses = r.body.media.map((m: { variants_status: string }) => m.variants_status);
    expect(statuses).toContain("ready");
    expect(statuses).toContain("pending");
    const times = r.body.media.map((m: { created_at: string }) => new Date(m.created_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("honors limit + offset", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/media?limit=2&offset=0`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.media.length).toBe(2);
    expect(r.body.limit).toBe(2);
  });

  it("404 for unknown site", async () => {
    const r = await request(app)
      .get(`/api/sites/00000000-0000-0000-0000-000000000000/media`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });
});
