/**
 * D608 (W2-DOM, 2026-07-30 product audit): the ONE transition function for
 * `site_domains.verification_status` / `ssl_status`.
 *
 * Before this existed, three writers free-wrote those columns with no guard:
 * the site-provision job's `markFailed`, the orchestrator's post-wait write,
 * and the GET status poll route — and the poll silently rewrote
 * `failed → pending` (erasing an exhausted-retry verdict the moment anyone
 * opened the Domains tab) and flapped `verified → pending` on any transient
 * condition read. Every status write MUST go through `applyDomainStatus`.
 *
 * Two modes, chosen by how much evidence the caller has:
 *
 *   - `"authoritative"` — the caller completed a real check: a full
 *     provision attempt (orchestrator with `wait`), an exhausted retry
 *     budget (job `markFailed`), or an explicit operator-triggered re-check
 *     (POST …/verify, the D515 sweep). Any transition is allowed.
 *     `last_error` is set from `next.error` on failure and cleared
 *     otherwise; `verified_at` is stamped when verification transitions
 *     into 'verified'.
 *
 *   - `"upgrade-only"` — a passive observation (the GET status poll that
 *     fires whenever the Domains tab is open). Only success values are
 *     applied: verification may move to 'verified', ssl to 'active'.
 *     pending/failed inputs never overwrite the stored value, and
 *     `last_error` survives until the domain is fully verified + active.
 *
 * Every write also touches `updated_at` (D516) so "stale pending" is a
 * queryable predicate (the D515 re-verification sweep keys off it).
 */

import type { Pool, PoolClient } from "pg";

export type VerificationStatus = "pending" | "verified" | "failed";
export type SslStatus = "pending" | "active" | "failed";

export type DomainStatusNext = {
  verification_status: VerificationStatus;
  ssl_status: SslStatus;
  /** Failure detail persisted to `last_error`. Ignored (cleared) unless a
   *  status is 'failed' — a recovering domain must not keep a stale error. */
  error?: string | null;
};

export type DomainStatusMode = "authoritative" | "upgrade-only";

/** Address a row by primary key or by hostname (the orchestrator's key). */
export type DomainRef = { id: string } | { hostname: string };

export type DomainStatusRow = {
  id: string;
  hostname: string;
  verification_status: VerificationStatus;
  ssl_status: SslStatus;
  last_error: string | null;
  updated_at: string;
  verified_at: string | null;
};

const RETURNING = `RETURNING id, hostname, verification_status, ssl_status, last_error, updated_at, verified_at`;

/**
 * Apply a guarded status transition. Returns the resulting row, or null when
 * no row matches `ref` (callers decide whether that is an error).
 */
export async function applyDomainStatus(
  db: Pool | PoolClient,
  ref: DomainRef,
  next: DomainStatusNext,
  mode: DomainStatusMode,
): Promise<DomainStatusRow | null> {
  const [whereSql, refValue] =
    "id" in ref ? ["id = $1", ref.id] : ["hostname = $1", ref.hostname];

  if (mode === "authoritative") {
    const failed = next.verification_status === "failed" || next.ssl_status === "failed";
    const lastError = failed ? (next.error ?? null) : null;
    const r = await db.query<DomainStatusRow>(
      `UPDATE site_domains SET
          verified_at = CASE
            WHEN $2 = 'verified' AND verification_status <> 'verified' THEN now()
            ELSE verified_at END,
          verification_status = $2,
          ssl_status = $3,
          last_error = $4,
          updated_at = now()
        WHERE ${whereSql}
        ${RETURNING}`,
      [refValue, next.verification_status, next.ssl_status, lastError],
    );
    return r.rows[0] ?? null;
  }

  // upgrade-only: apply success values only; leave everything else alone.
  // Single guarded UPDATE (not read-then-write) so concurrent writers can't
  // interleave a downgrade between the read and the write.
  const vUp = next.verification_status === "verified";
  const sUp = next.ssl_status === "active";
  const r = await db.query<DomainStatusRow>(
    `UPDATE site_domains SET
        verified_at = CASE
          WHEN $2 AND verification_status <> 'verified' THEN now()
          ELSE verified_at END,
        updated_at = CASE
          WHEN ($2 AND verification_status <> 'verified') OR ($3 AND ssl_status <> 'active') THEN now()
          ELSE updated_at END,
        verification_status = CASE WHEN $2 THEN 'verified' ELSE verification_status END,
        ssl_status = CASE WHEN $3 THEN 'active' ELSE ssl_status END,
        last_error = CASE WHEN $2 AND $3 THEN NULL ELSE last_error END
      WHERE ${whereSql}
      ${RETURNING}`,
    [refValue, vUp, sUp],
  );
  return r.rows[0] ?? null;
}

/**
 * Translate a Cloud Run domain-mapping's conditions into the status pair
 * every caller derives. Shared so the orchestrator, the verify route, and
 * the sweep can't drift on the mapping → status projection.
 */
export function statusFromMappingConditions(
  conditions: Array<{ type: string; status: string }> | undefined,
): { verification_status: VerificationStatus; ssl_status: SslStatus } {
  const ready = conditions?.find((c) => c.type === "Ready")?.status === "True";
  const cert = conditions?.find((c) => c.type === "CertificateProvisioned")?.status === "True";
  return {
    verification_status: ready ? "verified" : "pending",
    ssl_status: cert ? "active" : "pending",
  };
}
