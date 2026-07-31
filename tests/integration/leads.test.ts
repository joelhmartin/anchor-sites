import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { leadsRouter } from "../../src/server/routes/leads.js";
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

const TENANT_HOST = "muldoon-dental.sites.anchorcorps.com";

function buildApp(pool: Pool, rateLimitOpts?: { max: number; windowMs: number }): express.Express {
  const app = express();
  // Mirror app.ts: leads mounts under /api ahead of the D101 JSON terminator.
  app.use("/api", leadsRouter({ pool, ...(rateLimitOpts ? { rateLimitOpts } : {}) }));
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return app;
}

d("POST /api/leads — tenant lead capture (D700)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    // Generous window — every test in this file shares one client IP; the
    // per-IP limit itself is exercised with a dedicated tight app below.
    app = buildApp(pool, { max: 1000, windowMs: 60_000 });
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(async () => {
    __clearResolveSiteCacheForTests();
    await pool.query(`DELETE FROM leads`);
  });

  it("stores a form-encoded submission against the host-resolved site and returns a branded thank-you page", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ name: "Pat Doe", phone: "555-0100", details: "Broken crown", _page: "/contact" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    // Branded confirmation (form posts are plain HTML navigations).
    expect(res.text).toContain("Muldoon Dental");
    expect(res.text).toMatch(/[Tt]hank/);
    // Never index a confirmation page.
    expect(res.text).toContain('name="robots" content="noindex"');

    const rows = await pool.query(
      `SELECT l.page_hint, l.fields, s.slug
         FROM leads l JOIN sites s ON s.id = l.site_id`,
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].slug).toBe("muldoon-dental");
    expect(rows.rows[0].page_hint).toBe("/contact");
    expect(rows.rows[0].fields).toEqual({
      name: "Pat Doe",
      phone: "555-0100",
      details: "Broken crown",
    });
  });

  it("falls back to the Referer path for page_hint when no _page field is sent", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .set("Referer", `https://${TENANT_HOST}/book-a-call?utm=x`)
      .type("form")
      .send({ name: "Ref Test" });

    expect(res.status).toBe(200);
    const rows = await pool.query(`SELECT page_hint FROM leads`);
    expect(rows.rows[0].page_hint).toBe("/book-a-call");
  });

  it("honeypot: a filled `website` field returns the same thank-you but stores nothing", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ name: "Bot", website: "https://spam.example" });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/[Tt]hank/);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM leads`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("meta fields (_page, honeypot) are stripped from the stored payload", async () => {
    await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ email: "a@b.co", _page: "/contact", website: "" });

    const rows = await pool.query(`SELECT fields FROM leads`);
    expect(rows.rows[0].fields).toEqual({ email: "a@b.co" });
  });

  it("rejects a submission with no real fields", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ _page: "/contact", website: "" });

    expect(res.status).toBe(400);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM leads`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("caps abusive payloads (too many fields / oversized values)", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 60; i++) many[`f${i}`] = "x";
    const resMany = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send(many);
    expect(resMany.status).toBe(400);

    const resBig = await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ details: "y".repeat(6000) });
    expect(resBig.status).toBe(400);

    const rows = await pool.query(`SELECT count(*)::int AS n FROM leads`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("404s on an unknown host (no site to attribute the lead to)", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "nobody.example.com")
      .type("form")
      .send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("404s on the admin host — the studio is never a tenant", async () => {
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "studio.anchorcorps.com")
      .type("form")
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });

  it("rate limits per IP", async () => {
    const tightApp = buildApp(pool, { max: 2, windowMs: 60_000 });
    const post = () =>
      request(tightApp)
        .post("/api/leads")
        .set("Host", TENANT_HOST)
        .type("form")
        .send({ name: "Rate" });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
  });

  it("deleting a site cascades its leads (no orphan rows)", async () => {
    await request(app)
      .post("/api/leads")
      .set("Host", TENANT_HOST)
      .type("form")
      .send({ name: "Cascade" });
    await pool.query(`DELETE FROM sites WHERE slug = 'muldoon-dental'`);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM leads`);
    expect(rows.rows[0].n).toBe(0);
    // Restore the seeded site for any later suites in this fork.
    await seed(pool);
    __clearResolveSiteCacheForTests();
  });
});
