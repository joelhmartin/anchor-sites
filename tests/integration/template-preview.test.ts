import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { templatesRouter, type MaterializeEnqueue } from "../../src/server/routes/templates.js";
import { createTemplate } from "../../src/server/templates/repo.js";
import { handleMaterializeTemplate } from "../../src/server/jobs/materialize-template.js";
import { mintPreviewToken, mintTemplatePreviewToken } from "../../src/server/preview-token.js";

/**
 * W1.1 (2026-07-30 product-audit remediation) — template preview + retry
 * routes. Built-in templates have no `source_site_id`, so the preview route
 * renders `template_pages` blocks through the existing page-render pipeline
 * against a synthetic site; auth is the template-scoped preview token
 * (sandboxed iframe ⇒ query string is the only credential channel).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction, count, log: () => undefined });

const heroBlocks = (s: string) => [{ id: "h" + s, type: "hero", props: { title: "Hero " + s, align: "center" } }];

d("template preview + materialize-retry API (integration, W1.1)", () => {
  let pool: Pool;
  let app: express.Express;
  let appFailingEnqueue: express.Express;
  let enqueued: { siteId: string; templateId: string }[];
  let templateId: string;
  let retrySiteId: string;
  const MISSING_ID = "00000000-0000-4000-8000-000000000000";

  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });

    const tpl = await createTemplate(
      {
        slug: "tpv-two-pager",
        name: "TPV Two Pager",
        kind: "site",
        brand_tokens: { "--theme-main": "#0a3d62" },
        pages: [
          { slug: "home", title: "TPV Home", blocks: heroBlocks("home"), seo: {} },
          { slug: "about", title: "TPV About", blocks: heroBlocks("about"), seo: {} },
        ],
      },
      { pool },
    );
    templateId = tpl.template.id;

    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, status) VALUES ('tpv-retry-site', 'TPV Retry', 'active')
       ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    );
    retrySiteId = siteRes.rows[0].id;

    enqueued = [];
    const enqueue: MaterializeEnqueue = async (input) => {
      enqueued.push(input);
      await handleMaterializeTemplate(input, { pool });
      return { id: "test-job-" + enqueued.length };
    };
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", templatesRouter({ pool, saveRateLimit: { max: 200, windowMs: 60_000 }, enqueueMaterialize: enqueue }));

    const failing: MaterializeEnqueue = async () => {
      throw new Error("boss down");
    };
    appFailingEnqueue = express();
    appFailingEnqueue.use(express.json({ limit: "1mb" }));
    appFailingEnqueue.use(
      "/api",
      templatesRouter({ pool, saveRateLimit: { max: 200, windowMs: 60_000 }, enqueueMaterialize: failing }),
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM pages WHERE site_id = $1`, [retrySiteId]).catch(() => undefined);
    await pool.query(`DELETE FROM sites WHERE id = $1`, [retrySiteId]).catch(() => undefined);
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'tpv-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  describe("POST /api/templates/:id/preview-token", () => {
    it("401s without an admin credential", async () => {
      const res = await request(app).post(`/api/templates/${templateId}/preview-token`);
      expect(res.status).toBe(401);
    });

    it("404s for an unknown template", async () => {
      const res = await auth(request(app).post(`/api/templates/${MISSING_ID}/preview-token`));
      expect(res.status).toBe(404);
    });

    it("mints a ptv1 template-scoped token with an expiry", async () => {
      const res = await auth(request(app).post(`/api/templates/${templateId}/preview-token`));
      expect(res.status).toBe(200);
      expect(res.body.token.startsWith("ptv1.")).toBe(true);
      expect(Date.parse(res.body.expires_at)).toBeGreaterThan(Date.now());
    });
  });

  describe("GET /api/templates/:id/preview/:pageSlug?", () => {
    const tplToken = () => mintTemplatePreviewToken(templateId, { env: { ADMIN_API_TOKEN: ADMIN_TOKEN } })!.token;

    it("401s with no token and with a SITE-scoped token (scope isolation)", async () => {
      expect((await request(app).get(`/api/templates/${templateId}/preview`)).status).toBe(401);
      const siteToken = mintPreviewToken(templateId, { env: { ADMIN_API_TOKEN: ADMIN_TOKEN } })!.token;
      expect(
        (await request(app).get(`/api/templates/${templateId}/preview?token=${siteToken}`)).status,
      ).toBe(401);
    });

    it("renders the FIRST page as sandboxed HTML when no slug is given", async () => {
      const res = await request(app).get(`/api/templates/${templateId}/preview?token=${tplToken()}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-security-policy"]).toContain("sandbox allow-scripts");
      expect(res.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.text).toContain("Hero home");
      // Template name is the synthetic site's display name (shell header).
      expect(res.text).toContain("TPV Two Pager");
      // No tracking is ever injected into a sandboxed preview.
      expect(res.text).not.toContain("calltrackingmetrics");
    });

    it("renders a specific page by slug and 404s an unknown slug", async () => {
      const about = await request(app).get(
        `/api/templates/${templateId}/preview/about?token=${tplToken()}`,
      );
      expect(about.status).toBe(200);
      expect(about.text).toContain("Hero about");
      const missing = await request(app).get(
        `/api/templates/${templateId}/preview/nope?token=${tplToken()}`,
      );
      expect(missing.status).toBe(404);
    });

    it("also accepts the static admin token via the query shim (curl/dev path)", async () => {
      const res = await request(app).get(`/api/templates/${templateId}/preview?token=${ADMIN_TOKEN}`);
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/sites/:siteId/materialize-template (retry affordance, D703)", () => {
    it("401s without an admin credential", async () => {
      const res = await request(app)
        .post(`/api/sites/${retrySiteId}/materialize-template`)
        .send({ template_id: templateId });
      expect(res.status).toBe(401);
    });

    it("404s for an unknown site or template", async () => {
      expect(
        (
          await auth(request(app).post(`/api/sites/${MISSING_ID}/materialize-template`)).send({
            template_id: templateId,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await auth(request(app).post(`/api/sites/${retrySiteId}/materialize-template`)).send({
            template_id: MISSING_ID,
          })
        ).status,
      ).toBe(404);
    });

    it("202s, re-enqueues, and the pages actually materialize", async () => {
      const res = await auth(request(app).post(`/api/sites/${retrySiteId}/materialize-template`)).send({
        template_id: templateId,
      });
      expect(res.status).toBe(202);
      expect(res.body.job.queued).toBe(true);
      expect(enqueued).toContainEqual({ siteId: retrySiteId, templateId });
      const pages = await pool.query(`SELECT slug FROM pages WHERE site_id = $1 ORDER BY slug`, [retrySiteId]);
      expect(pages.rows.map((p) => p.slug)).toEqual(["about", "home"]);
    });

    it("503s with the error when the enqueue itself fails (honest, retryable)", async () => {
      const res = await auth(
        request(appFailingEnqueue).post(`/api/sites/${retrySiteId}/materialize-template`),
      ).send({ template_id: templateId });
      expect(res.status).toBe(503);
      expect(res.body.job.queued).toBe(false);
      expect(res.body.job.error).toContain("boss down");
    });
  });
});
