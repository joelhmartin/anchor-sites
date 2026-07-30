import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import {
  provisionSiteHostname,
  type ProvisionResult,
  type ProvisionOptions,
} from "../provisioning/orchestrator.js";

/**
 * pg-boss handler for `site.provision` (Task D1 — Kinsta DNS + auto-provision
 * on site create). Enqueued right after `createSiteWithDomains` commits the
 * new site + its canonical `*.sites.anchorcorps.com` domain row, so the
 * preview URL comes up (Cloud Run mapping + DNS) without an operator having
 * to open the Domains tab and click "Provision" by hand.
 *
 * Reuses `provisionSiteHostname` — the SAME orchestration the admin
 * "Provision" endpoints call — rather than duplicating the Cloud Run/DNS
 * step sequence here. `domainId` is only needed to know WHICH `site_domains`
 * row to mark on failure; the orchestrator itself resolves the hostname
 * from `sites.slug` and upserts/updates that row on success.
 *
 * Known limitation (see docs/deploy.md §9): the Cloud Run mapping step
 * succeeds only once the runtime service account
 * (333281424614-compute@developer.gserviceaccount.com) is a verified owner
 * of anchorcorps.com in Google Search Console (Webmaster Central) — a
 * one-time operator action. Until then `createIfMissing` fails with
 * PermissionDenied; this handler records that as a clean `failed` status on
 * the domain row (never an unhandled crash) and rethrows so pg-boss retries
 * per the `retryLimit`/`retryDelay` the caller enqueued with. The DNS step
 * creates a literal per-site record that coexists with the zone's
 * `*.sites` wildcard CNAME (exact-name matching never treats the wildcard
 * as "already exists"); this is idempotent per-site — retries for the same
 * hostname find the literal record. Bursts >5 site creates/min can hit
 * Kinsta's create rate limit and self-heal via the job's 60s backoff.
 */
export type SiteProvisionInput = { siteId: string; domainId: string };
export type SiteProvisionDeps = {
  pool?: Pool;
  /** Override the whole orchestration call — pure unit tests. */
  provision?: typeof provisionSiteHostname;
  /** Passed through to `provisionSiteHostname` — injectable dns/cloudRun for
   *  integration tests that want the real orchestrator against a fake
   *  network client instead of stubbing this handler's own call. */
  dns?: ProvisionOptions["dns"];
  cloudRun?: ProvisionOptions["cloudRun"];
};

async function markFailed(pool: Pool, domainId: string): Promise<void> {
  await pool.query(
    `UPDATE site_domains SET verification_status = 'failed', ssl_status = 'failed' WHERE id = $1`,
    [domainId],
  );
}

export async function handleSiteProvision(
  data: SiteProvisionInput,
  deps: SiteProvisionDeps = {},
): Promise<ProvisionResult> {
  const pool = deps.pool ?? defaultPool;
  const provision = deps.provision ?? provisionSiteHostname;
  const options: ProvisionOptions = { pool, dns: deps.dns, cloudRun: deps.cloudRun };

  let result: ProvisionResult;
  try {
    result = await provision(data.siteId, options);
  } catch (err) {
    // provisionSiteHostname only throws for "site not found" — the job is
    // enqueued right after the site row's transaction commits, so this
    // should never happen in steady state, but a slow-committing
    // transaction racing a fast-polling worker is exactly what the retry
    // (enqueued with a retryDelay) exists to absorb.
    await markFailed(pool, data.domainId);
    throw err instanceof Error ? err : new Error(String(err));
  }

  const failedStep = result.steps.find((s) => s.status === "error");
  if (failedStep) {
    await markFailed(pool, data.domainId);
    evictSiteCache(result.hostname);
    throw new Error(
      `site.provision: ${failedStep.step} failed for ${result.hostname}: ${failedStep.detail}`,
    );
  }

  return result;
}
