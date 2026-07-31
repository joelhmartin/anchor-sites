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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSitesRouter } from "../../src/server/routes/admin-sites.js";
import { resolveSite, __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";
import { ctmScriptTag } from "../../src/server/render-page.js";
import { createSiteWithDomains } from "../../src/server/sites/create-site.js";
import type { CrmClient } from "../../src/server/crm/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-crm-ctm";

// vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
// then guarantees this resets before the next test anywhere in the suite,
// regardless of how long any describe's own `afterAll` takes (root cause of
// the cross-file requireAdmin flake — see
// .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
beforeEach(() => {
  vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
});

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
    const a = express();
    a.use(express.json());
    a.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 } }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => {});
    await pool.end().catch(() => undefined);
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

// ---------------------------------------------------------------------------
// 11.7 — CRM provision in createSiteWithDomains
// ---------------------------------------------------------------------------
d("P11 — CRM provision in createSiteWithDomains", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("calls provisionSite and stores crm_site_id", async () => {
    const crmClient: CrmClient = {
      provisionSite: vi.fn().mockResolvedValue({ crmSiteId: "crm-from-mock" }),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const slug = `crm-provision-${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { siteId, provisionCrm } = await createSiteWithDomains(client, {
        slug,
        displayName: "CRM Test Site",
        crmClient,
      });
      // D1013: the CRM call is a post-COMMIT thunk — nothing network-bound
      // may run while the transaction is open.
      expect(crmClient.provisionSite).not.toHaveBeenCalled();
      await client.query("COMMIT");
      await provisionCrm();

      expect(crmClient.provisionSite).toHaveBeenCalledWith(siteId, "CRM Test Site", expect.stringContaining(slug));

      const row = await pool.query<{ crm_site_id: string | null }>(
        `SELECT crm_site_id FROM sites WHERE id = $1`,
        [siteId],
      );
      expect(row.rows[0].crm_site_id).toBe("crm-from-mock");
    } finally {
      client.release();
      await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
    }
  });

  it("does NOT fail site creation when provisionSite throws", async () => {
    const crmClient: CrmClient = {
      provisionSite: vi.fn().mockRejectedValue(new Error("CRM down")),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const slug = `crm-fail-${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { siteId, provisionCrm } = await createSiteWithDomains(client, {
        slug,
        displayName: "CRM Fail Site",
        crmClient,
      });
      await client.query("COMMIT");
      // D1013: the failing network call runs post-COMMIT and never rejects.
      await provisionCrm();
      // Site was created despite CRM failure
      const row = await pool.query<{ id: string; crm_site_id: string | null }>(
        `SELECT id, crm_site_id FROM sites WHERE id = $1`,
        [siteId],
      );
      expect(row.rows[0].id).toBe(siteId);
      expect(row.rows[0].crm_site_id).toBeNull();
    } finally {
      client.release();
      await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
    }
  });

  it("POST /api/sites calls provisionSite via injected crmClient", async () => {
    const crmClient: CrmClient = {
      provisionSite: vi.fn().mockResolvedValue({ crmSiteId: "crm-post-test" }),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const app = express();
    app.use(express.json());
    app.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 }, crmClient }));

    const slug = `crm-post-${Date.now()}`;
    const r = await request(app)
      .post("/api/sites")
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ slug, display_name: "Post CRM Test" });

    expect(r.status).toBe(201);
    expect(crmClient.provisionSite).toHaveBeenCalledTimes(1);

    await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
  });

  it("D1013: through POST /api/sites, provisionSite runs POST-COMMIT — the site row is already visible to other connections, and crm_site_id still lands", async () => {
    let visibleDuringCrmCall: boolean | null = null;
    const crmClient: CrmClient = {
      provisionSite: vi.fn(async (siteId: string) => {
        // `pool` is a DIFFERENT connection than the route's transaction
        // client — the row is only visible here if COMMIT already ran.
        const seen = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        visibleDuringCrmCall = (seen.rowCount ?? 0) > 0;
        return { crmSiteId: "crm-post-commit" };
      }),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const app = express();
    app.use(express.json());
    app.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 }, crmClient }));

    const slug = `crm-postcommit-${Date.now()}`;
    const r = await request(app)
      .post("/api/sites")
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ slug, display_name: "Post-commit CRM Test" });

    expect(r.status).toBe(201);
    expect(crmClient.provisionSite).toHaveBeenCalledTimes(1);
    expect(visibleDuringCrmCall).toBe(true);

    // The post-commit thunk's crm_site_id write still landed.
    const row = await pool.query<{ crm_site_id: string | null }>(
      `SELECT crm_site_id FROM sites WHERE id = $1`,
      [r.body.site.id],
    );
    expect(row.rows[0].crm_site_id).toBe("crm-post-commit");

    await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
  });

  it("PATCH /api/sites/:id calls updateSite when display_name changes and crm_site_id set", async () => {
    const crmClient: CrmClient = {
      provisionSite: vi.fn().mockResolvedValue({ crmSiteId: "crm-patch-test" }),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const slug = `crm-patch-${Date.now()}`;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens, crm_site_id)
       VALUES ($1, 'Old Name', '{}'::jsonb, 'crm-patch-test') RETURNING id`,
      [slug],
    );
    const siteId = ins.rows[0].id;

    const app = express();
    app.use(express.json());
    app.use("/api", adminSitesRouter({ pool, createRateLimit: { max: 1000, windowMs: 60_000 }, crmClient }));

    const r = await request(app)
      .patch(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ display_name: "New Name" });

    expect(r.status).toBe(200);
    // updateSite is fire-and-forget; give it a tick to run
    await new Promise((r) => setTimeout(r, 10));
    expect(crmClient.updateSite).toHaveBeenCalledWith("crm-patch-test", expect.objectContaining({ name: "New Name" }));

    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => {});
  });

  it("PATCH post-response CRM lookup failure is logged, never forwarded to next(err) (D102)", async () => {
    const crmClient: CrmClient = {
      provisionSite: vi.fn().mockResolvedValue({ crmSiteId: "crm-late-test" }),
      updateSite: vi.fn().mockResolvedValue(undefined),
      deprovisionSite: vi.fn().mockResolvedValue(undefined),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };

    const slug = `crm-late-${Date.now()}`;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens, crm_site_id)
       VALUES ($1, 'Old Name', '{}'::jsonb, 'crm-late-test') RETURNING id`,
      [slug],
    );
    const siteId = ins.rows[0].id;

    // Delegating pool whose primary-domain lookup (the query the PATCH
    // handler runs AFTER res.json) rejects — before D102 that rejection
    // reached next(err) and the error handler tried to write to an
    // already-sent response.
    const failingPool = {
      query: (text: unknown, params?: unknown[]) => {
        if (typeof text === "string" && text.includes("is_primary = true")) {
          return Promise.reject(new Error("site_domains lookup exploded"));
        }
        return (pool as unknown as { query: (t: unknown, p?: unknown[]) => Promise<unknown> }).query(text, params);
      },
      connect: () => pool.connect(),
    } as unknown as Pool;

    const app = express();
    app.use(express.json());
    app.use("/api", adminSitesRouter({ pool: failingPool, createRateLimit: { max: 1000, windowMs: 60_000 }, crmClient }));
    const forwarded: unknown[] = [];
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      forwarded.push(err);
      if (!res.headersSent) res.status(500).end();
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await request(app)
      .patch(`/api/sites/${siteId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ display_name: "New Name" });

    expect(r.status).toBe(200);
    expect(r.body.site.display_name).toBe("New Name");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(forwarded).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[crm]"),
      expect.objectContaining({ message: "site_domains lookup exploded" }),
    );
    // The lookup failed before updateSite could be called.
    expect(crmClient.updateSite).not.toHaveBeenCalled();

    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => {});
  });
});
