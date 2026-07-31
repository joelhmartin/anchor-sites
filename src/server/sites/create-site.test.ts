import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fix round 1, item 1: the `site.provision` enqueue failure path in
 * `createSiteWithDomains` used to swallow both the synchronous `getBoss()`
 * throw (pg-boss not booted) and the async `.send()` rejection with ZERO
 * logging — a domain row stuck at verification_status='pending' forever
 * with nothing in the logs to explain why. Mirrors the coverage the
 * existing CRM-provisioning failure path gets in
 * tests/integration/crm-ctm.test.ts ("does NOT fail site creation when
 * provisionSite throws") — site creation must still succeed — but ALSO
 * asserts the console.error call itself, since that's the specific thing
 * this fix round adds.
 *
 * `getBoss` is mocked (not just left un-booted) so both failure shapes can
 * be forced deterministically: a synchronous throw, and a promise that
 * rejects.
 */
const getBossMock = vi.fn();
vi.mock("../jobs/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../jobs/index.js")>();
  return {
    ...actual,
    getBoss: (...args: unknown[]) => getBossMock(...args),
  };
});

import { createSiteWithDomains } from "./create-site.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("createSiteWithDomains — site.provision enqueue failure logging (fix round 1, item 1)", () => {
  let pool: Pool;
  const createdSlugs: string[] = [];
  // Installed fresh in beforeEach (not once at describe scope) — Vitest
  // reinstalls its own console interceptor per test to capture output for
  // the reporter, which would otherwise clobber a spy installed only once.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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
  }, 60_000);

  afterAll(async () => {
    for (const slug of createdSlugs) {
      await pool.query(`DELETE FROM sites WHERE slug = $1`, [slug]).catch(() => {});
    }
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    getBossMock.mockReset();
  });

  it("logs via the sync try/catch (and still creates the site) when getBoss() throws — pg-boss not started", async () => {
    getBossMock.mockImplementation(() => {
      throw new Error("pg-boss not started — bootJobs() must run first (or JOBS_ENABLED=false)");
    });

    const slug = `provision-log-sync-${Date.now()}`;
    createdSlugs.push(slug);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { siteId, enqueueProvision } = await createSiteWithDomains(client, {
        slug,
        displayName: "Log Sync Co",
      });
      await client.query("COMMIT");
      await enqueueProvision();

      expect(siteId).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[provision] enqueue failed for site ${siteId}`),
        expect.any(Error),
      );
    } finally {
      client.release();
    }
  });

  it("logs via the async .catch() (and still creates the site) when boss.send() rejects", async () => {
    getBossMock.mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error("send failed: connection reset")),
    });

    const slug = `provision-log-async-${Date.now()}`;
    createdSlugs.push(slug);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { siteId, enqueueProvision } = await createSiteWithDomains(client, {
        slug,
        displayName: "Log Async Co",
      });
      await client.query("COMMIT");
      await enqueueProvision();

      expect(siteId).toBeDefined();
      // The .catch() handler runs on a later microtask than the enqueue
      // call site itself — give it a tick before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[provision] enqueue failed for site ${siteId}`),
        expect.any(Error),
      );
    } finally {
      client.release();
    }
  });

  // FINAL whole-branch review, FIX-NOW item 4 — enqueue must not happen
  // inside the caller's still-open transaction.
  it("does NOT enqueue inside the transaction — the returned enqueueProvision() does it after COMMIT (final review, item 4)", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    getBossMock.mockReturnValue({ send });

    const slug = `provision-after-commit-${Date.now()}`;
    createdSlugs.push(slug);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { siteId, canonicalDomainId, enqueueProvision } = await createSiteWithDomains(client, {
        slug,
        displayName: "After Commit Co",
      });

      // Still mid-transaction: nothing has been queued, so a worker cannot
      // possibly race the (not yet visible) site row.
      expect(getBossMock).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();

      await client.query("COMMIT");
      await enqueueProvision();

      expect(send).toHaveBeenCalledWith(
        "site.provision",
        { siteId, domainId: canonicalDomainId },
        expect.objectContaining({ singletonKey: canonicalDomainId }),
      );
    } finally {
      client.release();
    }
  });

  it("does NOT fail site creation when both getBoss() and send() are unavailable", async () => {
    getBossMock.mockImplementation(() => {
      throw new Error("boom");
    });

    const slug = `provision-log-no-fail-${Date.now()}`;
    createdSlugs.push(slug);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await createSiteWithDomains(client, { slug, displayName: "No Fail Co" });
      expect(created).toMatchObject({ canonical: `${slug}.sites.anchorcorps.com` });
      await client.query("COMMIT");
      await expect(created.enqueueProvision()).resolves.toBeUndefined();
    } finally {
      client.release();
    }
  });
});
