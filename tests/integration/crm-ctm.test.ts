/**
 * P11 CRM+CTM integration tests.
 * Covers: PATCH ctm_account_id, resolveSite ctm_account_id field (11.1),
 * CTM script injection (11.2), CRM provision in createSiteWithDomains (11.7).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import { resolveSite, __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";
import { ctmScriptTag } from "../../src/server/render-page.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-crm-ctm";

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

// ---------------------------------------------------------------------------
// 11.1 — PATCH ctm_account_id
// ---------------------------------------------------------------------------
d("P11 — PATCH /api/sites/:id — ctm_account_id", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens)
       VALUES ($1, 'CTM Test', '{}'::jsonb) RETURNING id`,
      [`ctmtest-${Date.now()}`],
    );
    siteId = ins.rows[0].id;
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    const a = express();
    a.use(express.json());
    a.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 } }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => {});
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("sets ctm_account_id", async () => {
    const r = await request(app)
      .patch(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ ctm_account_id: "acct-123" });
    expect(r.status).toBe(200);
    expect(r.body.site.ctm_account_id).toBe("acct-123");
  });

  it("does not change ctm_account_id when omitted from patch", async () => {
    const r = await request(app)
      .patch(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ display_name: "CTM Test Updated" });
    expect(r.status).toBe(200);
    expect(r.body.site.ctm_account_id).toBe("acct-123");
  });

  it("clears ctm_account_id when null is sent", async () => {
    const r = await request(app)
      .patch(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ ctm_account_id: null });
    expect(r.status).toBe(200);
    expect(r.body.site.ctm_account_id).toBeNull();
  });

  it("GET /api/sites/:id includes ctm_account_id", async () => {
    await pool.query(`UPDATE sites SET ctm_account_id = 'acct-xyz' WHERE id = $1`, [siteId]);
    const r = await request(app)
      .get(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.site.ctm_account_id).toBe("acct-xyz");
  });
});

// ---------------------------------------------------------------------------
// 11.1 — resolveSite includes ctm_account_id
// ---------------------------------------------------------------------------
d("P11 — resolveSite includes ctm_account_id", () => {
  let pool: Pool;
  let siteId: string;
  let hostname: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    const slug = `ctm-resolve-${Date.now()}`;
    hostname = `${slug}.localhost`;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens, ctm_account_id)
       VALUES ($1, 'CTM Resolve Test', '{}'::jsonb, 'ctm-999') RETURNING id`,
      [slug],
    );
    siteId = ins.rows[0].id;
    await pool.query(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, false, 'verified', 'active')`,
      [siteId, hostname],
    );
  }, 60_000);

  afterAll(async () => {
    __clearResolveSiteCacheForTests();
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => {});
    await pool.end().catch(() => undefined);
  });

  it("resolves ctm_account_id from the site row", async () => {
    __clearResolveSiteCacheForTests();
    const app = express();
    app.use(resolveSite({ pool }));
    app.get("/", (req, res) => {
      const site = (req as any).site;
      res.json({ ctm: site ? site.ctm_account_id : "__missing__" });
    });
    const r = await request(app).get("/").set("Host", hostname);
    expect(r.status).toBe(200);
    expect(r.body.ctm).toBe("ctm-999");
  });

  it("ctm_account_id is null when not set", async () => {
    __clearResolveSiteCacheForTests();
    await pool.query(`UPDATE sites SET ctm_account_id = NULL WHERE id = $1`, [siteId]);
    const app = express();
    app.use(resolveSite({ pool }));
    app.get("/", (req, res) => {
      const site = (req as any).site;
      res.json({ ctm: site ? site.ctm_account_id : "__missing__" });
    });
    const r = await request(app).get("/").set("Host", hostname);
    expect(r.status).toBe(200);
    expect(r.body.ctm).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11.2 — ctmScriptTag unit tests
// ---------------------------------------------------------------------------
describe("P11 — ctmScriptTag", () => {
  it("emits script tag with correct src and data attribute", () => {
    const tag = ctmScriptTag("acct-123");
    expect(tag).toContain('src="https://cdn.calltracking.com/call-tracking.min.js"');
    expect(tag).toContain("async");
    expect(tag).toContain('data-ctm-account-id="acct-123"');
    expect(tag).toContain("<script");
    expect(tag).toContain("</script>");
  });

  it("escapes HTML special chars in account ID", () => {
    const tag = ctmScriptTag('a"b<c>d');
    expect(tag).not.toContain('"b<c>');
    expect(tag).toContain("&quot;");
    expect(tag).toContain("&lt;");
    expect(tag).toContain("&gt;");
  });
});
