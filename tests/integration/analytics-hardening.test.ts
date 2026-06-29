/**
 * P12 — Task 12.1: analytics_disabled PATCH + resolveSite wiring.
 * Task 12.2: analytics script injection.
 * Task 12.3: POST /api/vitals.
 * Task 12.6: rate-limit on CRM phone-numbers proxy.
 * Task 12.7: pg-boss health endpoint.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// blocks/index.ts imports @anchorcorps/components (unbuilt in test env).
// The routes under test don't use the block registry; stub the side-effect.
vi.mock("../../src/blocks/index.js", () => ({}));
import { seed } from "../../db/seed.js";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import { vitalsRouter } from "../../src/server/routes/vitals.js";
import { adminJobsRouter } from "../../src/server/routes/admin-jobs.js";
import { adminCrmRouter } from "../../src/server/routes/admin-crm.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-analytics";

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

d("P12 — analytics_disabled PATCH field (12.1)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 } }));
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("PATCH analytics_disabled=true persists and is returned", async () => {
    const list = await request(app).get("/api/sites").set("X-Admin-Token", ADMIN_TOKEN);
    const site = list.body.sites[0];
    const r = await request(app)
      .patch(`/api/sites/${site.id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ analytics_disabled: true });
    expect(r.status).toBe(200);
    expect(r.body.site.analytics_disabled).toBe(true);
  });

  it("PATCH analytics_disabled=false clears it", async () => {
    const list = await request(app).get("/api/sites").set("X-Admin-Token", ADMIN_TOKEN);
    const site = list.body.sites[0];
    await request(app)
      .patch(`/api/sites/${site.id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ analytics_disabled: true });
    const r = await request(app)
      .patch(`/api/sites/${site.id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ analytics_disabled: false });
    expect(r.status).toBe(200);
    expect(r.body.site.analytics_disabled).toBe(false);
  });

  it("GET /api/sites/:id returns analytics_disabled field", async () => {
    const list = await request(app).get("/api/sites").set("X-Admin-Token", ADMIN_TOKEN);
    const site = list.body.sites[0];
    const r = await request(app)
      .get(`/api/sites/${site.id}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(typeof r.body.site.analytics_disabled).toBe("boolean");
  });
});

d("P12 — POST /api/vitals (12.3)", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", vitalsRouter({ rateLimitOpts: { max: 1000, windowMs: 60_000 } }));
  });

  it("accepts valid vitals payload and returns 204", async () => {
    const r = await request(app)
      .post("/api/vitals")
      .send({ name: "LCP", value: 1200, id: "v1", delta: 0 });
    expect(r.status).toBe(204);
  });

  it("rejects missing name with 400", async () => {
    const r = await request(app)
      .post("/api/vitals")
      .send({ value: 1200, id: "v1", delta: 0 });
    expect(r.status).toBe(400);
  });
});

d("P12 — pg-boss health endpoint (12.7)", () => {
  let app: express.Express;
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = express();
    app.use(express.json());
    app.use("/api", adminJobsRouter({ pool, bossEnabled: false }));
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("returns 200 with enabled:false when boss disabled", async () => {
    const r = await request(app)
      .get("/api/admin/jobs/health")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(false);
  });

  it("requires admin auth", async () => {
    const r = await request(app).get("/api/admin/jobs/health");
    expect(r.status).toBe(401);
  });
});

d("P12 — CRM phone-numbers rate limit (12.6)", () => {
  let app: express.Express;
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    const stubCrm = {
      listPhoneNumbers: async () => [],
      getCampaigns: async () => [],
      getOrCreateSite: async () => ({ id: "crm-123" }),
      updateSite: async () => {},
    };
    app = express();
    app.use(express.json());
    app.use(
      "/api",
      adminCrmRouter({
        pool,
        crmClient: stubCrm as never,
        phoneRateLimit: { max: 2, windowMs: 60_000 },
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("returns 429 after rate limit is hit", async () => {
    const list = await pool.query("SELECT id FROM sites LIMIT 1");
    const siteId = list.rows[0]?.id;
    if (!siteId) return;

    for (let i = 0; i < 2; i++) {
      await request(app)
        .get(`/api/sites/${siteId}/crm/phone-numbers`)
        .set("X-Admin-Token", ADMIN_TOKEN);
    }
    const r = await request(app)
      .get(`/api/sites/${siteId}/crm/phone-numbers`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(429);
  });
});
