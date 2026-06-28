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

function makeCloudRunMock(ready = true): CloudRunDomainsClient {
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
      resourceRecords: [
        {
          name: "muldoon-dental.sites.anchorcorps.com.",
          type: "CNAME",
          rrdata: "ghs.googlehosted.com.",
        },
      ],
    },
  };
  return {
    createIfMissing: vi.fn(async () => mapping),
    waitForReady: vi.fn(async () => mapping),
    getRequiredDnsRecords: vi.fn(async () => mapping.status.resourceRecords),
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
      expect.objectContaining({ type: "CNAME", data: "ghs.googlehosted.com." }),
    );
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
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

  it("throws when the site does not exist", async () => {
    await expect(
      provisionSiteHostname("00000000-0000-0000-0000-000000000000", { pool }),
    ).rejects.toThrow(/site not found/);
  });
});
