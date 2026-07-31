/**
 * D515 (W2-DOM): scheduled re-verification sweep for stale-pending domains.
 *
 * `site_domains` rows stick at 'pending' whenever provisioning stalls
 * (create-site.ts concedes this at its enqueue site) — and before this job
 * the ONLY recovery was a human opening the Domains tab (the passive poll)
 * or clicking Check now. This sweep gives pending rows an automatic path to
 * resolution: every run it re-checks rows that have been pending with no
 * status write for over an hour, and writes what Cloud Run actually reports
 * through the D608 transition helper (authoritative — a scheduled re-check
 * is a real check):
 *
 *   - mapping Ready/CertProvisioned → verified/active (the happy recovery)
 *   - mapping exists, not ready     → stays pending (updated_at touched, so
 *                                     the row waits another hour)
 *   - mapping MISSING               → honest 'failed' + instruction (the
 *                                     state the passive poll can never
 *                                     reach — D608's eternal-pending hole)
 *   - Cloud Run unreachable         → row untouched (transient; next sweep
 *                                     retries)
 *
 * 'failed' rows are deliberately NOT swept: failed is a terminal verdict
 * with a persisted last_error/instruction (D609); walking it back is the
 * operator's explicit Check-now/Provision call, not a background job's.
 *
 * `*.localhost` dev rows never have mappings and are excluded.
 */

import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import { CloudRunDomainsClient } from "../gcloud/run-domains.js";
import { applyDomainStatus, statusFromMappingConditions } from "../domains/status.js";

export const DOMAIN_VERIFY_SWEEP = "domain.verify-sweep";

/** A row is stale once no status write has touched it for this long. */
export const SWEEP_STALE_MINUTES = 60;

/** Cap per run — Cloud Run gets one GET per row. */
export const SWEEP_BATCH_LIMIT = 25;

export type SweepDeps = {
  pool?: Pool;
  cloudRun?: CloudRunDomainsClient;
  /** Override staleness for tests. */
  staleMinutes?: number;
};

export type SweepResult = {
  checked: number;
  verified: number;
  failed: number;
  still_pending: number;
  check_errors: number;
};

export async function sweepPendingDomains(deps: SweepDeps = {}): Promise<SweepResult> {
  const pool = deps.pool ?? defaultPool;
  const cloudRun = deps.cloudRun ?? new CloudRunDomainsClient();
  const staleMinutes = deps.staleMinutes ?? SWEEP_STALE_MINUTES;

  const rows = await pool.query<{ id: string; hostname: string }>(
    `SELECT id, hostname
       FROM site_domains
      WHERE (verification_status = 'pending' OR ssl_status = 'pending')
        AND verification_status <> 'failed'
        AND ssl_status <> 'failed'
        AND hostname NOT LIKE '%.localhost'
        AND updated_at < now() - ($1 * interval '1 minute')
      ORDER BY updated_at ASC
      LIMIT ${SWEEP_BATCH_LIMIT}`,
    [staleMinutes],
  );

  const result: SweepResult = {
    checked: 0,
    verified: 0,
    failed: 0,
    still_pending: 0,
    check_errors: 0,
  };

  for (const row of rows.rows) {
    result.checked += 1;
    let mapping;
    try {
      mapping = await cloudRun.get(row.hostname);
    } catch {
      // Transient Cloud Run trouble — leave the row for the next sweep.
      result.check_errors += 1;
      continue;
    }

    if (!mapping) {
      await applyDomainStatus(
        pool,
        { id: row.id },
        {
          verification_status: "failed",
          ssl_status: "failed",
          error:
            `no Cloud Run domain mapping exists for ${row.hostname} — provisioning has not ` +
            `completed (or the mapping was removed). Use Provision to create it.`,
        },
        "authoritative",
      );
      result.failed += 1;
    } else {
      const next = statusFromMappingConditions(mapping.status?.conditions);
      await applyDomainStatus(pool, { id: row.id }, next, "authoritative");
      if (next.verification_status === "verified" && next.ssl_status === "active") {
        result.verified += 1;
      } else {
        result.still_pending += 1;
      }
    }
    evictSiteCache(row.hostname);
  }

  return result;
}
