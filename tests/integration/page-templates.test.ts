import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { templatesRouter } from "../../src/server/routes/templates.js";
import { createTemplate } from "../../src/server/templates/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction, count, log: () => undefined });

d("page-level templates API (integration, P7-T7.9)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonSiteId: string;
  let homePageId: string;
  let pageTemplateId: string;
  let siteTemplateId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);

    const r = await pool.query<{ id: string; page_id: string }>(
      `SELECT s.id, p.id AS page_id FROM sites s JOIN pages p ON p.site_id = s.id
        WHERE s.slug = 'muldoon-dental' AND p.slug = 'home'`,
    );
    muldoonSiteId = r.rows[0].id;
    homePageId = r.rows[0].page_id;

    const pageTpl = await createTemplate(
      {
        slug: "pgtpl-snippet",
        name: "Snippet",
        kind: "page",
        pages: [{ slug: "promo", title: "Promo", blocks: [{ id: "r1", type: "rich-text", props: { html: "<p>Promo</p>" } }], seo: {} }],
      },
      { pool },
    );
    pageTemplateId = pageTpl.template.id;

    const siteTpl = await createTemplate({ slug: "pgtpl-site", name: "A Site", kind: "site", pages: [] }, { pool });
    siteTemplateId = siteTpl.template.id;

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    const a = express();
    a.use(express.json());
    a.use("/api", templatesRouter({ pool, saveRateLimit: { max: 200, windowMs: 60_000 } }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'pgtpl-%'`).catch(() => undefined);
    await pool.query(`DELETE FROM pages WHERE site_id = $1 AND slug IN ('promo','promo-2','from-pgtpl')`, [muldoonSiteId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  // ---- save a page as a template ----------------------------------------

  it("401s without an admin token", async () => {
    const res = await request(app).post(`/api/sites/${muldoonSiteId}/pages/${homePageId}/save-as-template`).send({ name: "x", slug: "pgtpl-x" });
    expect(res.status).toBe(401);
  });

  it("captures one page as a kind:'page' template with no brand tokens", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/${homePageId}/save-as-template`)).send({
      name: "Home Snapshot",
      slug: "pgtpl-home",
    });
    expect(res.status).toBe(201);
    expect(res.body.template.kind).toBe("page");
    expect(res.body.template.brand_tokens).toEqual({});

    const detail = await auth(request(app).get(`/api/templates/${res.body.template.id}`));
    expect(detail.body.pages).toHaveLength(1);
    expect(detail.body.pages[0].slug).toBe("home");
  });

  it("404s when the page is not on the site", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/00000000-0000-0000-0000-000000000000/save-as-template`)).send({ name: "Ghost", slug: "pgtpl-ghost" });
    expect(res.status).toBe(404);
  });

  it("409s on a duplicate template slug", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/${homePageId}/save-as-template`)).send({ name: "Dup", slug: "pgtpl-home" });
    expect(res.status).toBe(409);
  });

  // ---- add a page from a page template ----------------------------------

  it("inserts the template's page into a site (default slug/title) with an import revision", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/from-template`)).send({ template_id: pageTemplateId });
    expect(res.status).toBe(201);
    expect(res.body.page).toMatchObject({ slug: "promo", title: "Promo", status: "draft" });

    const rev = await pool.query<{ source: string }>(
      `SELECT pr.source FROM page_revisions pr JOIN pages p ON p.id = pr.page_id
        WHERE p.site_id = $1 AND p.slug = 'promo'`,
      [muldoonSiteId],
    );
    expect(rev.rows.map((r) => r.source)).toEqual(["import"]);
  });

  it("honors a slug override", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/from-template`)).send({ template_id: pageTemplateId, slug: "promo-2", title: "Promo Two" });
    expect(res.status).toBe(201);
    expect(res.body.page).toMatchObject({ slug: "promo-2", title: "Promo Two" });
  });

  it("409s when the target slug already exists on the site", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/from-template`)).send({ template_id: pageTemplateId, slug: "home" });
    expect(res.status).toBe(409);
  });

  it("400s when the template is a site template, not a page template", async () => {
    const res = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/from-template`)).send({ template_id: siteTemplateId, slug: "from-pgtpl" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a page template/);
  });

  it("404s for unknown site or template", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    const r1 = await auth(request(app).post(`/api/sites/${ghost}/pages/from-template`)).send({ template_id: pageTemplateId });
    expect(r1.status).toBe(404);
    const r2 = await auth(request(app).post(`/api/sites/${muldoonSiteId}/pages/from-template`)).send({ template_id: ghost });
    expect(r2.status).toBe(404);
  });
});
