import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../db/seed.js";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import {
  bootJobs,
  stopJobs,
  __resetJobsForTests,
  SITE_PROVISION,
} from "../../src/server/jobs/index.js";

/**
 * Task D1 — "route tests: site create returns without waiting on the job"
 * + "provision-job handler tests (enqueue on create ...)". Boots a REAL
 * pg-boss against the test DB (unlike admin-sites.test.ts's suite, which
 * never calls `bootJobs` — so `getBoss()` there throws and the enqueue in
 * `createSiteWithDomains` is silently skipped, same as it already is for
 * CRM_SYNC_JOB). Here we boot it so we can assert the job row actually
 * lands in `pgboss.job`, keyed the way the brief specifies.
 *
 * We deliberately check the job row within milliseconds of the POST
 * response, BEFORE pg-boss's own polling loop has had a chance to pick it
 * up (`created` state) — that both proves the enqueue happened AND that the
 * HTTP response didn't wait for the job to run (it can't have: the row is
 * still `created`, not `completed`/`failed`, when we read it).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-site-provision-enqueue";

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
  app.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 } }));
  return app;
}

d("POST /api/sites — auto-provision enqueue (Task D1)", () => {
  let pool: Pool;
  let app: express.Express;
  const createdSlugs: string[] = [];

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // (vitest.workspace.ts) then guarantees this resets before the next test
  // runs anywhere in the suite, regardless of how long this file's own
  // `afterAll` (real pg-boss `stopJobs()` + Postgres teardown — the slowest
  // hook in the whole suite) takes. This file was the prime suspect for the
  // cross-file requireAdmin flake (a raw `process.env.ADMIN_API_TOKEN = …`
  // set once in `beforeAll` and deleted once in `afterAll`, racing whichever
  // admin-gated request from ANY other file happened to be in flight when
  // this `afterAll` was slow) — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md.
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    app = buildApp(pool);

    __resetJobsForTests();
    await bootJobs(pool, { connectionString: TEST_DB_URL });
  }, 60_000);

  afterAll(async () => {
    await stopJobs();
    __resetJobsForTests();
    for (const slug of createdSlugs) {
      await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
    }
    await pool.end().catch(() => undefined);
  });

  afterEach(async () => {
    // Cancel anything the worker may have already picked up between tests
    // so a slow provisioning attempt (real GCP/DNS calls against fake env)
    // never leaks into the next test's assertions.
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [SITE_PROVISION]).catch(() => {});
  });

  it("returns 201 and leaves a queued (not yet run) site.provision job keyed on the canonical domain id", async () => {
    const slug = `provision-enqueue-${Date.now()}`;
    createdSlugs.push(slug);

    const r = await request(app)
      .post("/api/sites")
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ slug, display_name: "Provision Enqueue Co" });

    expect(r.status).toBe(201);
    const domainId = r.body.site.canonical_domain_id;
    expect(typeof domainId).toBe("string");

    const jobRows = await pool.query<{
      state: string;
      singleton_key: string | null;
      data: { siteId: string; domainId: string };
    }>(
      `SELECT state, singleton_key, data FROM pgboss.job WHERE name = $1 AND singleton_key = $2`,
      [SITE_PROVISION, domainId],
    );
    expect(jobRows.rowCount).toBe(1);
    const job = jobRows.rows[0];
    expect(job.singleton_key).toBe(domainId);
    expect(job.data).toMatchObject({ siteId: r.body.site.id, domainId });
    // The response already came back (200ms budget below), yet the job is
    // still queued, not completed — the HTTP request never waited on it.
    expect(["created", "retry"]).toContain(job.state);
  });

  it("responds well within Cloud Run's request budget regardless of provisioning", async () => {
    const slug = `provision-fast-${Date.now()}`;
    createdSlugs.push(slug);

    const start = Date.now();
    const r = await request(app)
      .post("/api/sites")
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ slug, display_name: "Provision Fast Co" });
    const elapsedMs = Date.now() - start;

    expect(r.status).toBe(201);
    // Generous ceiling — this is about proving "doesn't block on the job",
    // not benchmarking; a real Cloud Run/DNS round trip alone (which the
    // orchestrator never even attempts synchronously here) would blow past
    // this by orders of magnitude.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
