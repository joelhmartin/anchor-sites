/**
 * D425 — POST /api/sites/:siteId/crm/provision (retry CRM provisioning).
 * Re-runs the CRM `provisionSite` call for a site left with crm_site_id NULL
 * (anchor-hub was unreachable at create time) and persists the returned id.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminCrmRouter } from "../../src/server/routes/admin-crm.js";
import type { CrmClient } from "../../src/server/crm/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-crm-provision";

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

function stubCrm(crmSiteId: string): CrmClient {
  return {
    provisionSite: async () => ({ crmSiteId }),
    updateSite: async () => undefined,
    deprovisionSite: async () => undefined,
    listPhoneNumbers: async () => [],
    listCampaigns: async () => [],
  };
}

d("D425 — CRM re-provision route", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  async function makeSite(): Promise<string> {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens)
       VALUES ($1, 'CRM Reprovision', '{}'::jsonb) RETURNING id`,
      [`crmprov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    );
    return ins.rows[0].id;
  }

  function app(crm: CrmClient): express.Express {
    const a = express();
    a.use(express.json());
    a.use("/api", adminCrmRouter({ pool, crmClient: crm }));
    return a;
  }

  it("provisions and persists crm_site_id when it was NULL", async () => {
    const siteId = await makeSite();
    const r = await request(app(stubCrm("crm-fresh")))
      .post(`/api/sites/${siteId}/crm/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.crm_site_id).toBe("crm-fresh");
    const row = await pool.query(`SELECT crm_site_id FROM sites WHERE id = $1`, [siteId]);
    expect(row.rows[0].crm_site_id).toBe("crm-fresh");
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
  });

  it("is idempotent when already provisioned (no double-create)", async () => {
    const siteId = await makeSite();
    await pool.query(`UPDATE sites SET crm_site_id = 'crm-existing' WHERE id = $1`, [siteId]);
    const provisionSite = vi.fn(async () => ({ crmSiteId: "crm-should-not-be-used" }));
    const r = await request(app({ ...stubCrm("x"), provisionSite }))
      .post(`/api/sites/${siteId}/crm/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.crm_site_id).toBe("crm-existing");
    expect(r.body.already_provisioned).toBe(true);
    expect(provisionSite).not.toHaveBeenCalled();
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
  });

  it("503s when the CRM client returns no id (not configured)", async () => {
    const siteId = await makeSite();
    const r = await request(app(stubCrm("")))
      .post(`/api/sites/${siteId}/crm/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({});
    expect(r.status).toBe(503);
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
  });

  it("404s for an unknown site", async () => {
    const r = await request(app(stubCrm("x")))
      .post(`/api/sites/00000000-0000-0000-0000-000000000000/crm/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({});
    expect(r.status).toBe(404);
  });
});
