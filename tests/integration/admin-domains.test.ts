import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../db/seed.js";
import { adminDomainsRouter, type AdminDomainsOptions } from "../../src/server/routes/admin-domains.js";
import type { DnsProvider, DnsRecord, EnsureResult } from "../../src/server/dns/provider.js";
import type { CloudRunDomainsClient } from "../../src/server/gcloud/run-domains.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-domains";

// vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
// (vitest.workspace.ts) then guarantees this is reset before the NEXT test
// runs anywhere in the suite, regardless of how long any file's own
// `afterAll` (real Postgres queries, `pool.end()`) takes. A raw
// `process.env.ADMIN_API_TOKEN = …` set once per describe's `beforeAll` and
// deleted once in `afterAll` depended on that `afterAll` finishing before
// the next hook ran; when it didn't, the stale/missing token leaked into
// whichever admin-gated request happened to be in flight next (root cause
// of the cross-file requireAdmin flake — see
// .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
// One root-level hook covers every `describe` below — they all share this
// token.
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

function makeMockDns(): DnsProvider & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    id: "manual" as const,
    async ensureRecord(_zone: string, _rec: DnsRecord): Promise<EnsureResult> {
      calls.push({ method: "ensureRecord", args: [_zone, _rec] });
      return "external";
    },
    async verifyRecord(_zone: string, _rec: DnsRecord): Promise<boolean> {
      calls.push({ method: "verifyRecord", args: [_zone, _rec] });
      return false;
    },
    async removeRecord(_zone: string, _rec: DnsRecord): Promise<void> {
      calls.push({ method: "removeRecord", args: [_zone, _rec] });
    },
    calls,
  };
}

function makeMockCloudRun(
  mapping: { resourceRecords?: { name?: string; type?: string; rrdata?: string }[] } = {},
): CloudRunDomainsClient & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    cfg: { projectId: "test", region: "us-central1", serviceName: "anchor-sites" },
    async get(_hostname: string) {
      calls.push({ method: "get", args: [_hostname] });
      return {
        apiVersion: "domains.cloudrun.com/v1" as const,
        kind: "DomainMapping" as const,
        metadata: { name: _hostname, namespace: "test" },
        spec: { routeName: "anchor-sites" },
        status: { resourceRecords: mapping.resourceRecords ?? [] },
      };
    },
    async create(_hostname: string) {
      calls.push({ method: "create", args: [_hostname] });
      return {
        apiVersion: "domains.cloudrun.com/v1" as const,
        kind: "DomainMapping" as const,
        metadata: { name: _hostname, namespace: "test" },
        spec: { routeName: "anchor-sites" },
      };
    },
    async createIfMissing(_hostname: string) {
      calls.push({ method: "createIfMissing", args: [_hostname] });
      return {
        apiVersion: "domains.cloudrun.com/v1" as const,
        kind: "DomainMapping" as const,
        metadata: { name: _hostname, namespace: "test" },
        spec: { routeName: "anchor-sites" },
        status: { resourceRecords: mapping.resourceRecords ?? [] },
      };
    },
    async waitForReady(_hostname: string) {
      calls.push({ method: "waitForReady", args: [_hostname] });
      return {
        apiVersion: "domains.cloudrun.com/v1" as const,
        kind: "DomainMapping" as const,
        metadata: { name: _hostname, namespace: "test" },
        spec: { routeName: "anchor-sites" },
      };
    },
    async getRequiredDnsRecords(_hostname: string) {
      calls.push({ method: "getRequiredDnsRecords", args: [_hostname] });
      return mapping.resourceRecords ?? [];
    },
    async deleteMapping(_hostname: string) {
      calls.push({ method: "deleteMapping", args: [_hostname] });
    },
    calls,
  } as unknown as CloudRunDomainsClient & { calls: { method: string; args: unknown[] }[] };
}

function buildApp(pool: Pool, opts: Omit<AdminDomainsOptions, "pool"> = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminDomainsRouter({ pool, ...opts }));
  return app;
}

d("admin domains API — GET /api/sites/:siteId/domains (10.5)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("401 without admin token", async () => {
    const r = await request(app).get(`/api/sites/${muldoonId}/domains`);
    expect(r.status).toBe(401);
  });

  it("404 for unknown site", async () => {
    const r = await request(app)
      .get("/api/sites/00000000-0000-0000-0000-000000000000/domains")
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("lists domains for muldoon-dental with domain_class", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.domains)).toBe(true);

    const canonical = r.body.domains.find(
      (d: { hostname: string }) => d.hostname === "muldoon-dental.sites.anchorcorps.com",
    );
    expect(canonical).toBeDefined();
    expect(canonical.is_primary).toBe(true);
    expect(canonical.domain_class).toBe("managed");
    expect(["pending", "verified", "failed"]).toContain(canonical.verification_status);
    expect(["pending", "active", "failed"]).toContain(canonical.ssl_status);
  });

  it("classifies a client-owned domain as client-owned", async () => {
    await pool.query(
      `INSERT INTO site_domains (site_id, hostname, is_primary)
       VALUES ($1, 'client.example.com', false)
       ON CONFLICT (hostname) DO NOTHING`,
      [muldoonId],
    );
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    const client = r.body.domains.find(
      (d: { hostname: string }) => d.hostname === "client.example.com",
    );
    expect(client).toBeDefined();
    expect(client.domain_class).toBe("client-owned");
    // clean up
    await pool.query(`DELETE FROM site_domains WHERE hostname = 'client.example.com'`);
  });
});

d("admin domains API — POST /api/sites/:siteId/domains (10.5)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("400 for invalid hostname format", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ hostname: "not a valid hostname!" });
    expect(r.status).toBe(400);
  });

  it("400 for wildcard hostname", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ hostname: "*.example.com" });
    expect(r.status).toBe(400);
  });

  it("adds a client-owned hostname and classifies it", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ hostname: "acme.example.com" });
    expect(r.status).toBe(201);
    expect(r.body.domain.hostname).toBe("acme.example.com");
    expect(r.body.domain.domain_class).toBe("client-owned");
    expect(r.body.domain.is_primary).toBe(false);
    expect(r.body.domain.verification_status).toBe("pending");
    await pool.query(`DELETE FROM site_domains WHERE hostname = 'acme.example.com'`);
  });

  it("409 for hostname already in use by any site", async () => {
    // The canonical muldoon domain already exists.
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ hostname: "muldoon-dental.sites.anchorcorps.com" });
    expect(r.status).toBe(409);
  });

  it("404 for unknown site", async () => {
    const r = await request(app)
      .post("/api/sites/00000000-0000-0000-0000-000000000000/domains")
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ hostname: "something.example.com" });
    expect(r.status).toBe(404);
  });
});

d("admin domains API — DELETE /api/sites/:siteId/domains/:domainId (10.5)", () => {
  let pool: Pool;
  let mockDns: ReturnType<typeof makeMockDns>;
  let mockCloudRun: ReturnType<typeof makeMockCloudRun>;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    mockDns = makeMockDns();
    mockCloudRun = makeMockCloudRun({
      resourceRecords: [
        { name: "todelete.sites.anchorcorps.com", type: "CNAME", rrdata: "ghs.googlehosted.com." },
      ],
    });
    app = buildApp(pool, { dns: mockDns, cloudRun: mockCloudRun });
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("400 when trying to delete the primary domain", async () => {
    const dom = (
      await pool.query<{ id: string }>(
        `SELECT id FROM site_domains WHERE site_id = $1 AND is_primary = true LIMIT 1`,
        [muldoonId],
      )
    ).rows[0];
    const r = await request(app)
      .delete(`/api/sites/${muldoonId}/domains/${dom.id}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/primary/i);
  });

  it("deletes a non-primary domain: 200 {removed:true, warnings:[]}; reads cleanup targets BEFORE unmapping (D1002)", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, 'todelete.sites.anchorcorps.com', false, 'pending', 'pending')
       RETURNING id`,
      [muldoonId],
    );
    const domId = ins.rows[0].id;
    const prevCallCount = mockCloudRun.calls.length;
    const prevDnsCount = mockDns.calls.length;

    const r = await request(app)
      .delete(`/api/sites/${muldoonId}/domains/${domId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
    expect(r.body.warnings).toEqual([]);

    // Row deleted
    const check = await pool.query(`SELECT 1 FROM site_domains WHERE id = $1`, [domId]);
    expect(check.rowCount).toBe(0);

    // D1002: the required-records read happens BEFORE deleteMapping —
    // reading them off the just-deleted mapping always returned [] and DNS
    // was never cleaned up.
    const calls = mockCloudRun.calls.slice(prevCallCount);
    const readIdx = calls.findIndex((c) => c.method === "getRequiredDnsRecords");
    const delIdx = calls.findIndex((c) => c.method === "deleteMapping");
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(delIdx);

    // The pre-read records were actually removed from DNS (managed domain).
    const removes = mockDns.calls.slice(prevDnsCount).filter((c) => c.method === "removeRecord");
    expect(removes.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the row (retryable) and 502s when the Cloud Run unmap genuinely fails (D119)", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary)
       VALUES ($1, 'unmapfail.sites.anchorcorps.com', false) RETURNING id`,
      [muldoonId],
    );
    const domId = ins.rows[0].id;
    const failingCloudRun = {
      async getRequiredDnsRecords() {
        return [];
      },
      async deleteMapping() {
        throw new Error("Cloud Run 500 /unmapfail: internal error");
      },
    } as unknown as CloudRunDomainsClient;
    const failApp = buildApp(pool, { dns: makeMockDns(), cloudRun: failingCloudRun });

    const r = await request(failApp)
      .delete(`/api/sites/${muldoonId}/domains/${domId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/not removed/i);
    expect(r.body.warnings.join(" ")).toMatch(/Cloud Run 500/);

    // Row survives so Remove can be retried once the transient failure clears.
    const check = await pool.query(`SELECT 1 FROM site_domains WHERE id = $1`, [domId]);
    expect(check.rowCount).toBe(1);
    await pool.query(`DELETE FROM site_domains WHERE id = $1`, [domId]);
  });

  it("removes the row but returns warnings when DNS cleanup partially fails (D119)", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary)
       VALUES ($1, 'dnsfail.sites.anchorcorps.com', false) RETURNING id`,
      [muldoonId],
    );
    const domId = ins.rows[0].id;
    const failingDns = {
      id: "kinsta" as const,
      async ensureRecord() {
        return "created" as const;
      },
      async verifyRecord() {
        return true;
      },
      async removeRecord() {
        throw new Error("Kinsta 500: boom");
      },
    };
    const warnApp = buildApp(pool, {
      dns: failingDns,
      cloudRun: makeMockCloudRun({
        resourceRecords: [
          { name: "dnsfail.sites.anchorcorps.com", type: "CNAME", rrdata: "ghs.googlehosted.com." },
        ],
      }),
    });

    const r = await request(warnApp)
      .delete(`/api/sites/${muldoonId}/domains/${domId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
    expect(r.body.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.body.warnings.join(" ")).toMatch(/dnsfail\.sites\.anchorcorps\.com/);
    expect(r.body.warnings.join(" ")).toMatch(/Kinsta 500/);

    const check = await pool.query(`SELECT 1 FROM site_domains WHERE id = $1`, [domId]);
    expect(check.rowCount).toBe(0);
  });

  it("treats a 404 on unmap as already-unmapped (no warning, removed)", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary)
       VALUES ($1, 'already-unmapped.sites.anchorcorps.com', false) RETURNING id`,
      [muldoonId],
    );
    const domId = ins.rows[0].id;
    const cloudRun404 = {
      async getRequiredDnsRecords() {
        return [];
      },
      async deleteMapping() {
        throw new Error("Cloud Run 404 /already-unmapped: not found");
      },
    } as unknown as CloudRunDomainsClient;
    const app404 = buildApp(pool, { dns: makeMockDns(), cloudRun: cloudRun404 });

    const r = await request(app404)
      .delete(`/api/sites/${muldoonId}/domains/${domId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
    expect(r.body.warnings).toEqual([]);
  });

  it("404 for domain not belonging to this site", async () => {
    const r = await request(app)
      .delete(`/api/sites/${muldoonId}/domains/00000000-0000-0000-0000-000000000099`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });
});

d("admin domains API — POST provision + GET status (10.6)", () => {
  let pool: Pool;
  let mockDns: ReturnType<typeof makeMockDns>;
  let mockCloudRun: ReturnType<typeof makeMockCloudRun>;
  let app: express.Express;
  let muldoonId: string;
  let domainId: string;
  const hostname = "provision-test.example.com";

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, false, 'pending', 'pending')
       RETURNING id`,
      [muldoonId, hostname],
    );
    domainId = ins.rows[0].id;

    mockDns = makeMockDns();
    mockCloudRun = makeMockCloudRun({
      resourceRecords: [{ name: hostname, type: "CNAME", rrdata: "ghs.googlehosted.com." }],
    });
    app = buildApp(pool, { dns: mockDns, cloudRun: mockCloudRun });
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM site_domains WHERE hostname = $1`, [hostname]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("POST provision returns steps and required_records for client-owned domain", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/${domainId}/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.steps)).toBe(true);
    expect(r.body.required_records).toBeDefined();

    const cloudRunStep = r.body.steps.find((s: { step: string }) => s.step === "cloud_run");
    expect(cloudRunStep).toBeDefined();
    expect(cloudRunStep.status).toBe("ok");
  });

  it("GET status updates site_domains row and returns current status", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains/${domainId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.domain).toBeDefined();
    expect(r.body.domain.id).toBe(domainId);
    expect(["pending", "verified", "failed"]).toContain(r.body.domain.verification_status);
    expect(["pending", "active", "failed"]).toContain(r.body.domain.ssl_status);
  });

  it("provision 404 for unknown domain", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/00000000-0000-0000-0000-000000000000/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("status 404 for unknown domain", async () => {
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains/00000000-0000-0000-0000-000000000000/status`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });
});

d("admin domains API — POST set-primary (D110)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    // Restore the canonical primary for other suites sharing the seed DB.
    await pool.query(
      `UPDATE site_domains SET is_primary = (hostname = 'muldoon-dental.sites.anchorcorps.com')
        WHERE site_id = $1`,
      [muldoonId],
    );
    await pool.query(`DELETE FROM site_domains WHERE hostname = 'custom.d110-test.example.com'`);
    await pool.end().catch(() => undefined);
  });

  it("404 for unknown domain", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/00000000-0000-0000-0000-000000000000/set-primary`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("swaps is_primary transactionally: the custom domain becomes the canonical live URL", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, 'custom.d110-test.example.com', false, 'verified', 'active')
       RETURNING id`,
      [muldoonId],
    );
    const customId = ins.rows[0].id;

    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/${customId}/set-primary`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.domain.id).toBe(customId);
    expect(r.body.domain.is_primary).toBe(true);

    // Exactly ONE primary per site, and it's the custom domain now —
    // publish's live_url (WHERE is_primary = true) follows it.
    const primaries = await pool.query<{ hostname: string }>(
      `SELECT hostname FROM site_domains WHERE site_id = $1 AND is_primary = true`,
      [muldoonId],
    );
    expect(primaries.rows.map((p) => p.hostname)).toEqual(["custom.d110-test.example.com"]);
  });

  it("no-ops with 200 when the domain is already primary", async () => {
    const cur = await pool.query<{ id: string }>(
      `SELECT id FROM site_domains WHERE site_id = $1 AND is_primary = true`,
      [muldoonId],
    );
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/${cur.rows[0].id}/set-primary`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.domain.is_primary).toBe(true);

    const count = await pool.query(
      `SELECT count(*)::int AS n FROM site_domains WHERE site_id = $1 AND is_primary = true`,
      [muldoonId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});

d("admin domains API — status transitions (D608/D609)", () => {
  let pool: Pool;
  let muldoonId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM site_domains WHERE hostname LIKE '%.d608-test.example.com'`);
    await pool.end().catch(() => undefined);
  });

  async function insertDomain(hostname: string, verification = "pending", ssl = "pending") {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, false, $3, $4) RETURNING id`,
      [muldoonId, hostname, verification, ssl],
    );
    return r.rows[0].id;
  }

  it("provision failure persists 'failed' + last_error with the Webmaster-Central instruction (D609)", async () => {
    const domainId = await insertDomain("provfail.d608-test.example.com");
    const failingCloudRun = {
      async createIfMissing() {
        throw new Error("Cloud Run 403 /: PermissionDenied — caller is not authorized to administer the domain");
      },
    } as unknown as CloudRunDomainsClient;
    const app = buildApp(pool, { dns: makeMockDns(), cloudRun: failingCloudRun });

    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/${domainId}/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    const step = r.body.steps.find((s: { step: string }) => s.step === "cloud_run");
    expect(step.status).toBe("error");
    // The response detail carries the instruction…
    expect(step.detail).toMatch(/search\.google\.com\/search-console/);

    // …and it survives a reload: persisted onto the row.
    const row = await pool.query<{ verification_status: string; last_error: string | null }>(
      `SELECT verification_status, last_error FROM site_domains WHERE id = $1`,
      [domainId],
    );
    expect(row.rows[0].verification_status).toBe("failed");
    expect(row.rows[0].last_error).toMatch(/PermissionDenied/);
    expect(row.rows[0].last_error).toMatch(/verified OWNER/i);
  });

  it("GET list returns last_error so the UI can render the forward path", async () => {
    const app = buildApp(pool, { dns: makeMockDns(), cloudRun: makeMockCloudRun() });
    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    const failed = r.body.domains.find(
      (d: { hostname: string }) => d.hostname === "provfail.d608-test.example.com",
    );
    expect(failed).toBeDefined();
    expect(failed.last_error).toMatch(/PermissionDenied/);
    expect(failed.updated_at).toBeDefined();
  });

  it("the status poll NEVER downgrades a terminal 'failed' back to 'pending' (D608)", async () => {
    const domainId = await insertDomain("polldown.d608-test.example.com", "failed", "failed");
    await pool.query(`UPDATE site_domains SET last_error = 'exhausted retries' WHERE id = $1`, [domainId]);

    // Cloud Run reports a mapping that exists but is not ready — the old
    // code projected that to pending/pending, silently erasing the verdict.
    const app = buildApp(pool, {
      dns: makeMockDns(),
      cloudRun: {
        async get() {
          return {
            apiVersion: "domains.cloudrun.com/v1",
            kind: "DomainMapping",
            metadata: { name: "polldown.d608-test.example.com", namespace: "test" },
            spec: { routeName: "anchor-sites" },
            status: {
              conditions: [
                { type: "Ready", status: "Unknown" },
                { type: "CertificateProvisioned", status: "Unknown" },
              ],
            },
          };
        },
      } as unknown as CloudRunDomainsClient,
    });

    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains/${domainId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.domain.verification_status).toBe("failed");
    expect(r.body.domain.ssl_status).toBe("failed");
    expect(r.body.domain.last_error).toBe("exhausted retries");

    const row = await pool.query<{ verification_status: string }>(
      `SELECT verification_status FROM site_domains WHERE id = $1`,
      [domainId],
    );
    expect(row.rows[0].verification_status).toBe("failed");
  });

  it("the status poll DOES apply a genuine upgrade to verified/active", async () => {
    const domainId = await insertDomain("pollup.d608-test.example.com", "pending", "pending");
    const app = buildApp(pool, {
      dns: makeMockDns(),
      cloudRun: {
        async get() {
          return {
            apiVersion: "domains.cloudrun.com/v1",
            kind: "DomainMapping",
            metadata: { name: "pollup.d608-test.example.com", namespace: "test" },
            spec: { routeName: "anchor-sites" },
            status: {
              conditions: [
                { type: "Ready", status: "True" },
                { type: "CertificateProvisioned", status: "True" },
              ],
            },
          };
        },
      } as unknown as CloudRunDomainsClient,
    });

    const r = await request(app)
      .get(`/api/sites/${muldoonId}/domains/${domainId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.domain.verification_status).toBe("verified");
    expect(r.body.domain.ssl_status).toBe("active");
    expect(r.body.domain.verified_at).not.toBeNull();
  });
});

d("admin domains API — provision client-owned domain uses manual DNS (no opts.dns injection)", () => {
  let pool: Pool;
  let mockCloudRun: ReturnType<typeof makeMockCloudRun>;
  let app: express.Express;
  let muldoonId: string;
  let domainId: string;
  const hostname = "client-nodns.example.com";

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, false, 'pending', 'pending')
       RETURNING id`,
      [muldoonId, hostname],
    );
    domainId = ins.rows[0].id;

    mockCloudRun = makeMockCloudRun({
      resourceRecords: [{ name: hostname, type: "CNAME", rrdata: "ghs.googlehosted.com." }],
    });
    // No opts.dns — simulates production without GoDaddy creds (or with them: the code
    // must select ManualDnsProvider for client-owned domains regardless of env).
    app = buildApp(pool, { cloudRun: mockCloudRun });
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM site_domains WHERE hostname = $1`, [hostname]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("provision of client-owned domain reports external DNS (not a DNS error)", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonId}/domains/${domainId}/provision`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);

    const dnsStep = r.body.steps.find((s: { step: string }) => s.step === "dns");
    expect(dnsStep).toBeDefined();
    // Manual provider returns "external" for every record — should surface as ok/external, not error.
    expect(dnsStep.status).toBe("ok");
    expect(dnsStep.detail).toMatch(/external|manual/i);

    // Required records are still returned for the operator.
    expect(Array.isArray(r.body.required_records)).toBe(true);
    expect(r.body.required_records.length).toBeGreaterThan(0);
  });
});
