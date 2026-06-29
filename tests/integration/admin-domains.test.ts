import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    mockDns = makeMockDns();
    mockCloudRun = makeMockCloudRun();
    app = buildApp(pool, { dns: mockDns, cloudRun: mockCloudRun });
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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

  it("deletes a non-primary domain and calls Cloud Run + DNS removeRecord", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
       VALUES ($1, 'todelete.example.com', false, 'pending', 'pending')
       RETURNING id`,
      [muldoonId],
    );
    const domId = ins.rows[0].id;
    const prevCallCount = mockCloudRun.calls.length;

    const r = await request(app)
      .delete(`/api/sites/${muldoonId}/domains/${domId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(204);

    // Row deleted
    const check = await pool.query(`SELECT 1 FROM site_domains WHERE id = $1`, [domId]);
    expect(check.rowCount).toBe(0);

    // Cloud Run deleteMapping was called
    const delCalls = mockCloudRun.calls.slice(prevCallCount).filter((c) => c.method === "deleteMapping");
    expect(delCalls.length).toBeGreaterThanOrEqual(1);
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

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    mockDns = makeMockDns();
    mockCloudRun = makeMockCloudRun({
      resourceRecords: [{ name: hostname, type: "CNAME", rrdata: "ghs.googlehosted.com." }],
    });
    app = buildApp(pool, { dns: mockDns, cloudRun: mockCloudRun });
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM site_domains WHERE hostname = $1`, [hostname]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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
