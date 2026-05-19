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
import type { KinstaClient } from "../../src/server/kinsta/client.js";
import type { CloudRunDomainsClient } from "../../src/server/gcloud/run-domains.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

function makeKinstaMock(): KinstaClient {
  return {
    getDomainIdByName: vi.fn(async () => "kinsta-domain-id"),
    listDnsRecords: vi.fn(async () => []),
    addCname: vi.fn(async () => ({ status: 200, message: "ok" })),
  } as unknown as KinstaClient;
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
    },
  };
  return {
    createIfMissing: vi.fn(async () => mapping),
    waitForReady: vi.fn(async () => mapping),
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

  it("provisions a fresh hostname end-to-end (mocked Kinsta + Cloud Run)", async () => {
    const kinsta = makeKinstaMock();
    const cloudRun = makeCloudRunMock(true);
    const result: ProvisionResult = await provisionSiteHostname(muldoonId, {
      pool,
      kinsta,
      cloudRun,
      wait: true,
    });

    expect(result.hostname).toBe("muldoon-dental.sites.anchorcorps.com");
    const stepStatuses = Object.fromEntries(result.steps.map((s) => [s.step, s.status]));
    expect(stepStatuses).toMatchObject({
      lookup: "ok",
      site_domains: "ok",
      kinsta: "ok",
      cloud_run: "ok",
      wait_ready: "ok",
    });
    expect(result.ready).toBe(true);
    expect(kinsta.addCname).toHaveBeenCalledOnce();
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
  });

  it("skips Kinsta when a matching CNAME already exists", async () => {
    const kinsta = makeKinstaMock();
    // Pretend the record exists already.
    (kinsta.listDnsRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        type: "CNAME",
        name: "muldoon-dental.sites.anchorcorps.com.",
        ttl: 3600,
        resource_records: [{ value: "ghs.googlehosted.com." }],
      },
    ]);
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, { pool, kinsta, cloudRun });

    expect(kinsta.addCname).not.toHaveBeenCalled();
    const kinstaStep = result.steps.find((s) => s.step === "kinsta");
    expect(kinstaStep?.status).toBe("skipped");
  });

  it("returns 'ready: false' when wait is omitted, but mapping is still created", async () => {
    const kinsta = makeKinstaMock();
    const cloudRun = makeCloudRunMock(false);
    const result = await provisionSiteHostname(muldoonId, {
      pool,
      kinsta,
      cloudRun,
      // wait omitted
    });
    expect(result.ready).toBe(false);
    expect(cloudRun.createIfMissing).toHaveBeenCalled();
    expect(cloudRun.waitForReady).not.toHaveBeenCalled();
  });

  it("surfaces Kinsta errors as a failed step + returns early", async () => {
    const kinsta = makeKinstaMock();
    (kinsta.getDomainIdByName as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no Kinsta domain matches anchorcorps.com"),
    );
    const cloudRun = makeCloudRunMock(true);
    const result = await provisionSiteHostname(muldoonId, { pool, kinsta, cloudRun, wait: true });

    expect(result.ready).toBe(false);
    const kinstaStep = result.steps.find((s) => s.step === "kinsta");
    expect(kinstaStep?.status).toBe("error");
    expect(cloudRun.createIfMissing).not.toHaveBeenCalled();
  });

  it("throws when the site does not exist", async () => {
    await expect(
      provisionSiteHostname("00000000-0000-0000-0000-000000000000", { pool }),
    ).rejects.toThrow(/site not found/);
  });
});
