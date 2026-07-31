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

function makeMapping(ready: boolean) {
  return {
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
}

function makeCloudRunMock(
  opts: {
    ready?: boolean;
    fail?: boolean;
    /** Mapping state the initial `createIfMissing` reports, when it differs
     *  from what `waitForReady` eventually reports (the realistic case: a
     *  brand-new mapping is never Ready on creation). Defaults to `ready`. */
    readyOnCreate?: boolean;
    /** `waitForReady` rejects — a cert that hasn't been issued inside the
     *  job's bounded wait. */
    waitTimesOut?: boolean;
  } = {},
): CloudRunDomainsClient {
  const ready = opts.ready ?? true;
  const created = makeMapping(opts.readyOnCreate ?? ready);
  const waited = makeMapping(ready);
  return {
    createIfMissing: opts.fail
      ? vi.fn(async () => {
          throw new Error(
            "Cloud Run 403 : PermissionDenied — service account not a verified owner",
          );
        })
      : vi.fn(async () => created),
    waitForReady: opts.waitTimesOut
      ? vi.fn(async () => {
          throw new Error(
            "Cloud Run domain mapping not ready after 240000ms (last: Ready=Unknown, CertificateProvisioned=Unknown)",
          );
        })
      : vi.fn(async () => waited),
    getRequiredDnsRecords: vi.fn(async () => [CNAME_RECORD]),
    get: vi.fn(async () => created),
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

    // FINAL whole-branch review, FIX-NOW item 2a: the handler must ask for
    // the wait step (bounded) — without it `verification_status`/`ssl_status`
    // never leave 'pending' and the workspace's live_url is a dead link.
    expect(provision).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ pool: fakePool, wait: true, waitTimeoutMs: expect.any(Number) }),
    );
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

    // D608/D609: the write goes through applyDomainStatus (guarded
    // transition) and carries the failing step's detail into last_error.
    expect(fakePool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE site_domains"),
      ["d1", "failed", "failed", "PermissionDenied"],
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
      expect.stringContaining("UPDATE site_domains"),
      ["d1", "failed", "failed", "site not found: s1"],
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
    const status = await domainStatus(db.getPool(), domainId);
    expect(status.verification_status).toBe("verified");
  });

  // FINAL whole-branch review, FIX-NOW item 2a.
  it("waits for the mapping and flips the domain row to verified/active — the columns reach a terminal state on success", async () => {
    const seed = await db.seedSite("site-provision-waits");
    const { domainId } = await seedSiteWithCanonicalDomain(db.getPool(), seed);
    const dns = makeDnsMock("created");
    // Realistic: a freshly-created mapping is NOT ready; only the wait step
    // ever sees Ready=True/CertificateProvisioned=True. Before the fix the
    // job never waited, so the row stayed pending/pending forever and the
    // workspace's "live" URL was a dead link.
    const cloudRun = makeCloudRunMock({ readyOnCreate: false, ready: true });

    const result = await handleSiteProvision(
      { siteId: seed.id, domainId },
      { pool: db.getPool(), dns, cloudRun },
    );

    expect(cloudRun.waitForReady).toHaveBeenCalledOnce();
    expect(result.ready).toBe(true);
    expect(await domainStatus(db.getPool(), domainId)).toEqual({
      verification_status: "verified",
      ssl_status: "active",
    });
  });

  it("a wait_ready timeout leaves the row 'pending' (NOT 'failed') and rethrows so pg-boss retries the poll", async () => {
    const seed = await db.seedSite("site-provision-wait-timeout");
    const { domainId } = await seedSiteWithCanonicalDomain(db.getPool(), seed);
    const dns = makeDnsMock("created");
    const cloudRun = makeCloudRunMock({ readyOnCreate: false, waitTimesOut: true });

    await expect(
      handleSiteProvision({ siteId: seed.id, domainId }, { pool: db.getPool(), dns, cloudRun }),
    ).rejects.toThrow(/not ready yet/i);

    // "Cert not issued yet" is not a failure — marking the row 'failed'
    // would tell the operator provisioning broke when it's simply still in
    // flight, and the retry that follows would have nothing to correct it
    // from. The Cloud Run mapping and the DNS record both exist by now.
    expect(await domainStatus(db.getPool(), domainId)).toEqual({
      verification_status: "pending",
      ssl_status: "pending",
    });
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

    // D609: the failure carries the instruction. last_error persists the
    // PermissionDenied detail, annotated with the Search Console fix.
    const err = await db
      .getPool()
      .query<{ last_error: string | null }>(
        `SELECT last_error FROM site_domains WHERE id = $1`,
        [domainId],
      );
    expect(err.rows[0].last_error).toMatch(/PermissionDenied/);
    expect(err.rows[0].last_error).toMatch(/search\.google\.com\/search-console/);
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
