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
