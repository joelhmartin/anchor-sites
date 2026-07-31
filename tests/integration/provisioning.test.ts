import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import {
  provisionSiteHostname,
  type ProvisionResult,
} from "../../src/server/provisioning/orchestrator.js";
import type { DnsProvider, EnsureResult } from "../../src/server/dns/provider.js";
import type { CloudRunDomainsClient } from "../../src/server/gcloud/run-domains.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

function makeDnsMock(ensure: EnsureResult = "created"): DnsProvider {
  return {
    id: "godaddy",
    ensureRecord: vi.fn(async () => ensure),
    verifyRecord: vi.fn(async () => true),
    removeRecord: vi.fn(async () => undefined),
  } as unknown as DnsProvider;
}

type DnsRR = { name: string; type: string; rrdata: string };

const CNAME_RECORD: DnsRR = {
  name: "muldoon-dental.sites.anchorcorps.com.",
  type: "CNAME",
  rrdata: "ghs.googlehosted.com.",
};

type CloudRunMockOptions = {
  ready?: boolean;
  /** Records embedded in `mapping.status.resourceRecords` (primary path). */
  resourceRecords?: DnsRR[];
  /** Records returned by `getRequiredDnsRecords` (fallback path). */
  fallbackRecords?: DnsRR[];
};

function makeCloudRunMock(
  opts: boolean | CloudRunMockOptions = true,
): CloudRunDomainsClient {
  const o: CloudRunMockOptions = typeof opts === "boolean" ? { ready: opts } : opts;
  const ready = o.ready ?? true;
  const resourceRecords = o.resourceRecords ?? [CNAME_RECORD];
  const fallbackRecords = o.fallbackRecords ?? resourceRecords;
  const mapping = {
    apiVersion: "domains.cloudrun.com/v1",
    kind: "DomainMapping",
    metadata: { name: "x", namespace: "p" },
    spec: { routeName: "anchor-sites" },
    status: {
      conditions: ready
        ? [
            { type: "Ready", status: "True" },
            { type: "CertificateProvisioned", status: "True" },
          ]
        : [
            { type: "Ready", status: "Unknown" },
            { type: "CertificateProvisioned", status: "Unknown" },
          ],
      resourceRecords,
    },
  };
  return {
    createIfMissing: vi.fn(async () => mapping),
    waitForReady: vi.fn(async () => mapping),
    getRequiredDnsRecords: vi.fn(async () => fallbackRecords),
    get: vi.fn(async () => mapping),
  } as unknown as CloudRunDomainsClient;
}

d("provisionSiteHostname (integration)", () => {
  let pool: Pool;
  let muldoonId: string;

  beforeAll(async () => {
    await migrate({
      databaseUrl: TEST_DB_URL!,
      dir: MIGRATIONS_DIR,
      migrationsTable: "pgmigrations",
      direction: "up",
      count: Infinity,
      log: () => undefined,
    });
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'muldoon-dental'`,
    );
    muldoonId = r.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("provisions a fresh hostname end-to-end (mocked DNS + Cloud Run)", async () => {
    const dns = makeDnsMock("created");
    const cloudRun = makeCloudRunMock(true);
    const result: ProvisionResult = await provisionSiteHostname(muldoonId, {
      pool,
      dns,
      cloudRun,
      wait: true,
    });

    expect(result.hostname).toBe("muldoon-dental.sites.anchorcorps.com");
    const stepStatuses = Object.fromEntries(result.steps.map((s) => [s.step, s.status]));
    expect(stepStatuses).toMatchObject({
      lookup: "ok",
      site_domains: "ok",
      cloud_run: "ok",
      dns: "ok",
      wait_ready: "ok",
    });
    expect(result.ready).toBe(true);
    expect(dns.ensureRecord).toHaveBeenCalledWith(
      "anchorcorps.com",
      expect.objectContaining({
        name: "muldoon-dental.sites.anchorcorps.com.",
        type: "CNAME",
        data: "ghs.googlehosted.com.",
      }),
    );
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
    // Primary path: resourceRecords is populated, so the fallback never runs.
    expect(cloudRun.getRequiredDnsRecords).not.toHaveBeenCalled();
  });

  it("falls back to getRequiredDnsRecords when the mapping has no resourceRecords", async () => {
    const dns = makeDnsMock("created");
    // Mapping created with empty resourceRecords (common right after creation);
    // the real records only come back from getRequiredDnsRecords.
    const cloudRun = makeCloudRunMock({
      ready: true,
      resourceRecords: [],
      fallbackRecords: [CNAME_RECORD],
    });
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun, wait: true });

    expect(cloudRun.getRequiredDnsRecords).toHaveBeenCalledOnce();
    expect(dns.ensureRecord).toHaveBeenCalledWith(
      "anchorcorps.com",
      expect.objectContaining({
        name: "muldoon-dental.sites.anchorcorps.com.",
        type: "CNAME",
        data: "ghs.googlehosted.com.",
      }),
    );
    const dnsStep = result.steps.find((s) => s.step === "dns");
    expect(dnsStep?.status).toBe("ok");
  });

  it("marks the dns step 'skipped' when Cloud Run reports no records at all", async () => {
    const dns = makeDnsMock();
    const cloudRun = makeCloudRunMock({
      ready: true,
      resourceRecords: [],
      fallbackRecords: [],
    });
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun, wait: true });

    const dnsStep = result.steps.find((s) => s.step === "dns");
    expect(dnsStep?.status).toBe("skipped");
    expect(dns.ensureRecord).not.toHaveBeenCalled();
  });

  it("marks the dns step 'skipped' when the record already exists", async () => {
    const dns = makeDnsMock("exists");
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun });

    const dnsStep = result.steps.find((s) => s.step === "dns");
    expect(dnsStep?.status).toBe("skipped");
    expect(dns.ensureRecord).toHaveBeenCalledOnce();
  });

  it("returns 'ready: false' when wait is omitted, but mapping is still created", async () => {
    const dns = makeDnsMock();
    const cloudRun = makeCloudRunMock(false);
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun });
    expect(result.ready).toBe(false);
    expect(cloudRun.createIfMissing).toHaveBeenCalled();
    expect(cloudRun.waitForReady).not.toHaveBeenCalled();
  });

  it("surfaces DNS errors as a failed step + returns early", async () => {
    const dns = makeDnsMock();
    (dns.ensureRecord as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("GoDaddy 500 boom"),
    );
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun, wait: true });

    expect(result.ready).toBe(false);
    const dnsStep = result.steps.find((s) => s.step === "dns");
    expect(dnsStep?.status).toBe("error");
    // Cloud Run mapping now happens BEFORE dns, so it ran:
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
    expect(cloudRun.waitForReady).not.toHaveBeenCalled();
  });

  it("manual-mode provider: dns step is 'skipped' with detail listing records", async () => {
    const manualDns: DnsProvider = {
      id: "manual",
      ensureRecord: vi.fn(async () => "external" as EnsureResult),
      verifyRecord: vi.fn(async () => false),
      removeRecord: vi.fn(async () => undefined),
    };
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, {
      pool,
      dns: manualDns,
      cloudRun,
      wait: false,
    });

    const dnsStep = result.steps.find((s) => s.step === "dns");
    expect(dnsStep?.status).toBe("skipped");
    expect(dnsStep?.detail).toMatch(/manually/i);
    expect(manualDns.ensureRecord).toHaveBeenCalledWith(
      "anchorcorps.com",
      expect.objectContaining({ type: "CNAME" }),
    );
  });

  it("throws when the site does not exist", async () => {
    await expect(
      provisionSiteHostname("00000000-0000-0000-0000-000000000000", { pool }),
    ).rejects.toThrow(/site not found/);
  });

  // D1014: «"Upserted" must not paper over a hostname owned by another
  // site». ON CONFLICT DO NOTHING used to report ok+upserted even when the
  // site_domains row belonged to a DIFFERENT site_id — and provisioning
  // proceeded against a hostname that routes elsewhere.
  it("emits a site_domains step error (and stops) when the hostname belongs to a different site", async () => {
    const slug = "d1014-conflict-site";
    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ($1, 'D1014 Conflict') RETURNING id`,
      [slug],
    );
    const newSiteId = siteRes.rows[0].id;
    // The canonical hostname for the NEW site is already claimed by muldoon.
    const hostname = `${slug}.sites.anchorcorps.com`;
    await pool.query(
      `INSERT INTO site_domains (site_id, hostname, is_primary) VALUES ($1, $2, false)`,
      [muldoonId, hostname],
    );

    const dns = makeDnsMock();
    const cloudRun = makeCloudRunMock(true);
    try {
      const result = await provisionSiteHostname(newSiteId, { pool, dns, cloudRun, wait: true });

      const step = result.steps.find((s) => s.step === "site_domains");
      expect(step?.status).toBe("error");
      expect(step?.status === "error" && step.detail).toMatch(/different site/i);
      expect(result.ready).toBe(false);
      // Provisioning must NOT proceed against a hostname that routes elsewhere.
      expect(cloudRun.createIfMissing).not.toHaveBeenCalled();
      expect(dns.ensureRecord).not.toHaveBeenCalled();
      // The other site's row is untouched — still owned by muldoon, no
      // failed/last_error stomped onto it.
      const row = await pool.query<{ site_id: string; last_error: string | null }>(
        `SELECT site_id, last_error FROM site_domains WHERE hostname = $1`,
        [hostname],
      );
      expect(row.rows[0].site_id).toBe(muldoonId);
      expect(row.rows[0].last_error).toBeNull();
    } finally {
      await pool.query(`DELETE FROM site_domains WHERE hostname = $1`, [hostname]);
      await pool.query(`DELETE FROM sites WHERE id = $1`, [newSiteId]);
    }
  });

  it("treats the site's OWN pre-existing row as ok (idempotent re-provision)", async () => {
    // muldoon's canonical row already exists (seed) and belongs to muldoon.
    const dns = makeDnsMock("exists");
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun });

    const step = result.steps.find((s) => s.step === "site_domains");
    expect(step?.status).toBe("ok");
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
  });
});
