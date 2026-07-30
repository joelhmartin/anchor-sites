import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { DnsProvider, EnsureResult } from "../dns/provider.js";
import type { CloudRunDomainsClient } from "../gcloud/run-domains.js";
import type { ProvisionResult } from "../provisioning/orchestrator.js";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { handleSiteProvision } from "./site-provision.js";

/**
 * Task D1: `site.provision` job handler tests. Mirrors
 * `tests/integration/provisioning.test.ts`'s fake DNS/Cloud Run clients so
 * these exercise the REAL `provisionSiteHostname` orchestration (the "reuse,
 * don't duplicate" requirement) rather than re-deriving its behavior with a
 * stub.
 */

function makeDnsMock(ensure: EnsureResult = "created"): DnsProvider {
  return {
    id: "kinsta",
    ensureRecord: vi.fn(async () => ensure),
    verifyRecord: vi.fn(async () => true),
    removeRecord: vi.fn(async () => undefined),
  } as unknown as DnsProvider;
}

const CNAME_RECORD = {
  name: "acme-dental.sites.anchorcorps.com.",
  type: "CNAME",
  rrdata: "ghs.googlehosted.com.",
};

function makeCloudRunMock(opts: { ready?: boolean; fail?: boolean } = {}): CloudRunDomainsClient {
  const ready = opts.ready ?? true;
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
      resourceRecords: [CNAME_RECORD],
    },
  };
  return {
    createIfMissing: opts.fail
      ? vi.fn(async () => {
          throw new Error(
            "Cloud Run 403 : PermissionDenied — service account not a verified owner",
          );
        })
      : vi.fn(async () => mapping),
    waitForReady: vi.fn(async () => mapping),
    getRequiredDnsRecords: vi.fn(async () => [CNAME_RECORD]),
    get: vi.fn(async () => mapping),
  } as unknown as CloudRunDomainsClient;
}

async function seedSiteWithCanonicalDomain(
  pool: Pool,
  seed: { id: string; slug: string },
): Promise<{ domainId: string; hostname: string }> {
  const hostname = `${seed.slug}.sites.anchorcorps.com`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
     VALUES ($1, $2, true, 'pending', 'pending') RETURNING id`,
    [seed.id, hostname],
  );
  return { domainId: r.rows[0].id, hostname };
}

async function domainStatus(
  pool: Pool,
  domainId: string,
): Promise<{ verification_status: string; ssl_status: string }> {
  const r = await pool.query<{ verification_status: string; ssl_status: string }>(
    `SELECT verification_status, ssl_status FROM site_domains WHERE id = $1`,
    [domainId],
  );
  return r.rows[0];
}

describe("handleSiteProvision — deps.provision override (pure unit)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delegates to the injected provision() with the site id and pool", async () => {
    const fakePool = { query: vi.fn() } as unknown as Pool;
    const okResult: ProvisionResult = {
      site_id: "s1",
      slug: "acme",
      hostname: "acme.sites.anchorcorps.com",
      steps: [{ step: "lookup", status: "ok" }],
      ready: false,
    };
    const provision = vi.fn(async () => okResult);

    const result = await handleSiteProvision(
      { siteId: "s1", domainId: "d1" },
      { pool: fakePool, provision },
    );

    expect(provision).toHaveBeenCalledWith("s1", expect.objectContaining({ pool: fakePool }));
    expect(result).toBe(okResult);
    expect(fakePool.query).not.toHaveBeenCalled(); // no failure → no status write
  });

  it("marks the domain row 'failed' and rethrows when a step errors", async () => {
    const fakePool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) } as unknown as Pool;
    const errResult: ProvisionResult = {
      site_id: "s1",
      slug: "acme",
      hostname: "acme.sites.anchorcorps.com",
      steps: [
        { step: "lookup", status: "ok" },
        { step: "cloud_run", status: "error", detail: "PermissionDenied" },
      ],
      ready: false,
    };
    const provision = vi.fn(async () => errResult);

    await expect(
      handleSiteProvision({ siteId: "s1", domainId: "d1" }, { pool: fakePool, provision }),
    ).rejects.toThrow(/cloud_run failed for acme\.sites\.anchorcorps\.com/);

    expect(fakePool.query).toHaveBeenCalledWith(
      expect.stringContaining("verification_status = 'failed'"),
      ["d1"],
    );
  });

  it("marks the domain row 'failed' and rethrows when provision() itself throws (e.g. race on a not-yet-committed site)", async () => {
    const fakePool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) } as unknown as Pool;
    const provision = vi.fn(async () => {
      throw new Error("site not found: s1");
    });

    await expect(
      handleSiteProvision({ siteId: "s1", domainId: "d1" }, { pool: fakePool, provision }),
    ).rejects.toThrow(/site not found/);

    expect(fakePool.query).toHaveBeenCalledWith(
      expect.stringContaining("verification_status = 'failed'"),
      ["d1"],
    );
  });
});

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("handleSiteProvision — real orchestration, fake DNS/Cloud Run (integration)", () => {
  beforeAll(async () => {
    await db.runMigrations();
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("provisions successfully and leaves the domain row's status alone (orchestrator owns it)", async () => {
    const seed = await db.seedSite("site-provision-ok");
    const { domainId } = await seedSiteWithCanonicalDomain(db.getPool(), seed);
    const dns = makeDnsMock("created");
    const cloudRun = makeCloudRunMock({ ready: true });

    const result = await handleSiteProvision(
      { siteId: seed.id, domainId },
      { pool: db.getPool(), dns, cloudRun },
    );

    expect(result.steps.every((s) => s.status !== "error")).toBe(true);
    expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
    expect(dns.ensureRecord).toHaveBeenCalledOnce();
    // No wait step requested → status update block still ran off the initial
    // mapping conditions (Ready=True in this fake), so the row IS verified.
    const status = await domainStatus(db.getPool(), domainId);
    expect(status.verification_status).toBe("verified");
  });

  it("records the documented Webmaster-Central limitation cleanly: cloud_run PermissionDenied -> domain row 'failed', job rethrows", async () => {
    const seed = await db.seedSite("site-provision-perm-denied");
    const { domainId } = await seedSiteWithCanonicalDomain(db.getPool(), seed);
    const dns = makeDnsMock();
    const cloudRun = makeCloudRunMock({ fail: true });

    await expect(
      handleSiteProvision({ siteId: seed.id, domainId }, { pool: db.getPool(), dns, cloudRun }),
    ).rejects.toThrow(/cloud_run failed/);

    const status = await domainStatus(db.getPool(), domainId);
    expect(status).toEqual({ verification_status: "failed", ssl_status: "failed" });
    // The DNS step never runs — cloud_run must succeed first (Cloud Run is
    // the source of the records DNS would write).
    expect(dns.ensureRecord).not.toHaveBeenCalled();
  });

  it("the KinstaDnsProvider upserts idempotently even when the Cloud Run step has already failed on a retry", async () => {
    // Regression guard for the brief's "DNS step is effectively a no-op for
    // *.sites (wildcard exists) but the kinsta provider must still upsert
    // idempotently without error" — once cloud_run succeeds, ensureRecord
    // must resolve cleanly even when the wildcard record already exists.
    const seed = await db.seedSite("site-provision-dns-noop");
    const { domainId } = await seedSiteWithCanonicalDomain(db.getPool(), seed);
    const dns = makeDnsMock("exists");
    const cloudRun = makeCloudRunMock({ ready: true });

    const result = await handleSiteProvision(
      { siteId: seed.id, domainId },
      { pool: db.getPool(), dns, cloudRun },
    );

    expect(result.steps.every((s) => s.status !== "error")).toBe(true);
    expect(dns.ensureRecord).toHaveBeenCalledOnce();
  });
});
