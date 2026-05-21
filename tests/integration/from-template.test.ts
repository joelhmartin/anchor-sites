import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { templatesRouter, type MaterializeEnqueue } from "../../src/server/routes/templates.js";
import { createTemplate, archiveTemplate } from "../../src/server/templates/repo.js";
import { handleMaterializeTemplate } from "../../src/server/jobs/materialize-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction, count, log: () => undefined });

const blocks = (s: string) => [{ id: "h" + s, type: "hero", props: { title: "Hero " + s, align: "center" } }];

d("create-site-from-template API (integration, P7-T7.6)", () => {
  let pool: Pool;
  let app: express.Express;
  let enqueued: { siteId: string; templateId: string }[];
  let siteTemplateId: string;
  let pageTemplateId: string;
  let archivedTemplateId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });

    const site = await createTemplate(
      {
        slug: "fttpl-base",
        name: "FT Base",
        kind: "site",
        brand_tokens: { "--theme-main": "#0a3d62" },
        pages: [
          { slug: "home", title: "Home", blocks: blocks("home"), seo: {} },
          { slug: "about", title: "About", blocks: blocks("about"), seo: {} },
        ],
      },
      { pool },
    );
    siteTemplateId = site.template.id;

    const pageTpl = await createTemplate(
      { slug: "fttpl-page", name: "FT Page", kind: "page", pages: [{ slug: "snippet", title: "Snippet", blocks: [] }] },
      { pool },
    );
    pageTemplateId = pageTpl.template.id;

    const arch = await createTemplate({ slug: "fttpl-archived", name: "FT Archived", kind: "site", pages: [] }, { pool });
    await archiveTemplate(arch.template.id, { pool });
    archivedTemplateId = arch.template.id;

    // Enqueue stub: record + run the handler synchronously so assertions can
    // observe materialized pages within the request lifecycle.
    enqueued = [];
    const enqueue: MaterializeEnqueue = async (input) => {
      enqueued.push(input);
      await handleMaterializeTemplate(input, { pool });
      return { id: "test-job-" + enqueued.length };
    };

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    const a = express();
    a.use(express.json());
    a.use("/api", templatesRouter({ pool, saveRateLimit: { max: 200, windowMs: 60_000 }, enqueueMaterialize: enqueue }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug LIKE 'ftsite-%'`).catch(() => undefined);
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'fttpl-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("401s without an admin token", async () => {
    const res = await request(app).post(`/api/sites/from-template`).send({ slug: "ftsite-x", display_name: "X", template_id: siteTemplateId });
    expect(res.status).toBe(401);
  });

  it("creates the site, enqueues materialization, and (via the worker) lands the template's pages + brand tokens", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({
      slug: "ftsite-new",
      display_name: "FT New Site",
      template_id: siteTemplateId,
    });
    expect(res.status).toBe(201);
    expect(res.body.site.slug).toBe("ftsite-new");
    expect(res.body.site.canonical_hostname).toContain("ftsite-new");
    expect(res.body.template_id).toBe(siteTemplateId);
    expect(res.body.job.queued).toBe(true);
    expect(enqueued.at(-1)).toMatchObject({ templateId: siteTemplateId });

    const siteId = res.body.site.id;
    const pages = await pool.query<{ slug: string }>(`SELECT slug FROM pages WHERE site_id = $1 ORDER BY slug`, [siteId]);
    expect(pages.rows.map((p) => p.slug)).toEqual(["about", "home"]);
    const site = await pool.query<{ default_brand_tokens: Record<string, string> }>(`SELECT default_brand_tokens FROM sites WHERE id = $1`, [siteId]);
    expect(site.rows[0].default_brand_tokens).toEqual({ "--theme-main": "#0a3d62" });
  });

  it("uses operator-provided brand tokens and does not let the template override them", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({
      slug: "ftsite-branded",
      display_name: "FT Branded",
      template_id: siteTemplateId,
      brand_tokens: { "--theme-main": "#ffffff" },
    });
    expect(res.status).toBe(201);
    const site = await pool.query<{ default_brand_tokens: Record<string, string> }>(`SELECT default_brand_tokens FROM sites WHERE id = $1`, [res.body.site.id]);
    expect(site.rows[0].default_brand_tokens).toEqual({ "--theme-main": "#ffffff" });
  });

  it("400s on an invalid payload (bad slug)", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({ slug: "Bad Slug", display_name: "X", template_id: siteTemplateId });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown template", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({ slug: "ftsite-ghost", display_name: "Ghost", template_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("400s when the template is a page template, not a site template", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({ slug: "ftsite-pagekind", display_name: "PK", template_id: pageTemplateId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a site template/);
  });

  it("400s when the template is archived", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({ slug: "ftsite-arch", display_name: "Arch", template_id: archivedTemplateId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived/);
  });

  it("409s on a duplicate site slug", async () => {
    const res = await auth(request(app).post(`/api/sites/from-template`)).send({ slug: "ftsite-new", display_name: "Dup", template_id: siteTemplateId });
    expect(res.status).toBe(409);
  });
});
