import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { templatesRouter } from "../../src/server/routes/templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";

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
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", templatesRouter({ pool, saveRateLimit: { max: 200, windowMs: 60_000 } }));
  return app;
}

const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

d("save-as-template API (integration, P7-T7.3)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonSiteId: string;
  let homePageId: string;
  let servicesPageId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);

    const r = await pool.query<{ id: string; page_id: string }>(
      `SELECT s.id, p.id AS page_id
         FROM sites s JOIN pages p ON p.site_id = s.id
        WHERE s.slug = 'muldoon-dental' AND p.slug = 'home'`,
    );
    muldoonSiteId = r.rows[0].id;
    homePageId = r.rows[0].page_id;

    // A second page so subset/multi-page capture is exercised.
    const sp = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'services', 'Services', '[]'::jsonb, '{}'::jsonb, 'draft')
       ON CONFLICT (site_id, slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [muldoonSiteId],
    );
    servicesPageId = sp.rows[0].id;

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'apitest-%' OR slug = 'my-starter'`).catch(() => undefined);
    await pool.query(`DELETE FROM pages WHERE id = $1`, [servicesPageId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("401s without an admin token", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/save-as-template`)
      .send({ name: "x", slug: "apitest-noauth" });
    expect(res.status).toBe(401);
  });

  it("captures all pages + brand tokens and derives a slug from the name", async () => {
    const res = await auth(
      request(app).post(`/api/sites/${muldoonSiteId}/save-as-template`),
    ).send({ name: "My Starter" });
    expect(res.status).toBe(201);
    expect(res.body.template.slug).toBe("my-starter");
    expect(res.body.template.kind).toBe("site");
    expect(res.body.template.source_site_id).toBe(muldoonSiteId);
    expect(res.body.template.pages_count).toBe(2); // home + services
    // muldoon seed sets brand tokens; they should be captured.
    expect(Object.keys(res.body.template.brand_tokens).length).toBeGreaterThan(0);

    // It actually persisted, with the captured pages.
    const tpl = await pool.query(`SELECT id FROM templates WHERE slug = 'my-starter'`);
    expect(tpl.rowCount).toBe(1);
    const pages = await pool.query(
      `SELECT slug FROM template_pages WHERE template_id = $1 ORDER BY sort_order`,
      [tpl.rows[0].id],
    );
    expect(pages.rows.map((p) => p.slug)).toEqual(["home", "services"]);
  });

  it("include_brand_tokens:false captures no brand tokens", async () => {
    const res = await auth(
      request(app).post(`/api/sites/${muldoonSiteId}/save-as-template`),
    ).send({ name: "No Brand", slug: "apitest-nobrand", include_brand_tokens: false });
    expect(res.status).toBe(201);
    expect(res.body.template.brand_tokens).toEqual({});
  });

  it("captures only the requested page_ids, in the given order", async () => {
    const res = await auth(
      request(app).post(`/api/sites/${muldoonSiteId}/save-as-template`),
    ).send({ name: "Subset", slug: "apitest-subset", page_ids: [servicesPageId] });
    expect(res.status).toBe(201);
    expect(res.body.template.pages_count).toBe(1);

    const tpl = await pool.query(`SELECT id FROM templates WHERE slug = 'apitest-subset'`);
    const pages = await pool.query(
      `SELECT slug FROM template_pages WHERE template_id = $1`,
      [tpl.rows[0].id],
    );
    expect(pages.rows.map((p) => p.slug)).toEqual(["services"]);
  });

  it("400s when page_ids references a page not on this site", async () => {
    const foreign = "00000000-0000-0000-0000-000000000000";
    const res = await auth(
      request(app).post(`/api/sites/${muldoonSiteId}/save-as-template`),
    ).send({ name: "Bad", slug: "apitest-foreign", page_ids: [foreign] });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown site", async () => {
    const res = await auth(
      request(app).post(`/api/sites/00000000-0000-0000-0000-000000000000/save-as-template`),
    ).send({ name: "Ghost", slug: "apitest-ghost" });
    expect(res.status).toBe(404);
  });

  it("409s on a duplicate template slug", async () => {
    const res = await auth(
      request(app).post(`/api/sites/${muldoonSiteId}/save-as-template`),
    ).send({ name: "Dup", slug: "my-starter" });
    expect(res.status).toBe(409);
    expect(res.body.slug).toBe("my-starter");
  });
});
