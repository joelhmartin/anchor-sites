import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import {
  provisionSiteHostname,
  type ProvisionResult,
  type ProvisionOptions,
} from "../provisioning/orchestrator.js";
import { applyDomainStatus } from "../domains/status.js";

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
/**
 * How long ONE attempt polls Cloud Run for `Ready` + `CertificateProvisioned`
 * before giving up and letting pg-boss retry.
 *
 * FINAL whole-branch review, FIX-NOW item 2a: this handler used to call the
 * orchestrator with no `wait` at all, so `site_domains.verification_status` /
 * `ssl_status` were written from the conditions on a *just-created* mapping —
 * always `pending`/`pending`, forever. Nothing else ever revisited those
 * columns, so the workspace's "live" URL was a permanent dead link and the
 * Domains tab's status poll never moved.
 *
 * The manual route (`POST /api/sites/:siteId/provision`) passes `wait`
 * straight through and lets the HTTP caller sit for the orchestrator's full
 * 20-minute default. A job can't: pg-boss's default job expiration is 15
 * minutes, and a handler that outlives it gets re-run underneath itself. So
 * this is a BOUNDED wait — 4 minutes per attempt — plus pg-boss's own
 * retry/backoff (`retryLimit: 5, retryDelay: 60, retryBackoff: true`, set at
 * the enqueue site in sites/create-site.ts). That's poll-with-a-bounded-wait:
 * ~50 minutes of total coverage across attempts, each attempt re-entering an
 * idempotent orchestrator, with no attempt anywhere near the expiration.
 */
export const PROVISION_WAIT_TIMEOUT_MS = 4 * 60 * 1000;

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
  /** Override the per-attempt cert wait. Tests only. */
  waitTimeoutMs?: number;
};

/**
 * D608/D609: route the failure write through the guarded transition helper
 * and persist WHY (the failing step's detail — already annotated with the
 * Webmaster-Central instruction by the orchestrator when it applies) into
 * `site_domains.last_error`, so DomainsTab can render a forward path
 * instead of a bare 'failed' badge.
 */
async function markFailed(pool: Pool, domainId: string, detail: string): Promise<void> {
  await applyDomainStatus(
    pool,
    { id: domainId },
    { verification_status: "failed", ssl_status: "failed", error: detail },
    "authoritative",
  );
}

export async function handleSiteProvision(
  data: SiteProvisionInput,
  deps: SiteProvisionDeps = {},
): Promise<ProvisionResult> {
  const pool = deps.pool ?? defaultPool;
  const provision = deps.provision ?? provisionSiteHostname;
  const options: ProvisionOptions = {
    pool,
    dns: deps.dns,
    cloudRun: deps.cloudRun,
    // Item 2a — the whole point: the orchestrator only writes a TERMINAL
    // verification/ssl status when it has waited for the mapping to report
    // Ready + CertificateProvisioned.
    wait: true,
    waitTimeoutMs: deps.waitTimeoutMs ?? PROVISION_WAIT_TIMEOUT_MS,
  };

  let result: ProvisionResult;
  try {
    result = await provision(data.siteId, options);
  } catch (err) {
    // provisionSiteHostname only throws for "site not found" — the job is
    // enqueued right after the site row's transaction commits, so this
    // should never happen in steady state, but a slow-committing
    // transaction racing a fast-polling worker is exactly what the retry
    // (enqueued with a retryDelay) exists to absorb.
    await markFailed(pool, data.domainId, err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }

  const failedStep = result.steps.find((s) => s.status === "error");
  if (failedStep) {
    // Item 2a — `wait_ready` is NOT a failure. Every other step erroring
    // means provisioning is genuinely broken (a Cloud Run permission
    // problem, a DNS API rejection) and the operator needs to see 'failed'
    // on the domain row. A wait timeout means only "the cert isn't issued
    // yet": the mapping and the DNS record both exist, the row's honest
    // state is still 'pending', and the right move is to let pg-boss retry
    // (each retry re-enters the idempotent orchestrator and polls again).
    // Marking it 'failed' here would have been an outright lie the retry
    // couldn't even walk back — a successful later attempt writes
    // verified/active, but an exhausted retry budget would leave 'failed'
    // on a domain that was merely slow.
    if (failedStep.step === "wait_ready") {
      evictSiteCache(result.hostname);
      throw new Error(
        `site.provision: ${result.hostname} not ready yet (cert still provisioning) — ${failedStep.detail}`,
      );
    }
    await markFailed(pool, data.domainId, failedStep.detail);
    evictSiteCache(result.hostname);
    throw new Error(
      `site.provision: ${failedStep.step} failed for ${result.hostname}: ${failedStep.detail}`,
    );
  }

  return result;
}
