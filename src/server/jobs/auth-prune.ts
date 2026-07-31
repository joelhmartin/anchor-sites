import type { Pool } from "pg";

/**
 * D805 — session terminality, server side: prune expired auth rows.
 *
 * Better-auth never deletes expired `auth_session` rows on its own (an
 * expired row is simply treated as no-session and left in place), and
 * abandoned OAuth state accretes in `auth_verification` forever — one row per
 * started-but-never-finished Google redirect. The tenant tables
 * (`tenant_auth_session` / `tenant_auth_verification`) share the exact same
 * shape and the same problem, so they're swept together even though the
 * tenant auth surface is not yet mounted (their tables exist and their rows
 * would otherwise be immortal).
 *
 * Mechanism: a tiny scheduled pg-boss job (see jobs/index.ts) — the least
 * machinery that ACTUALLY RUNS now that W1.4 pinned `--min-instances=1`
 * (before that, a scheduled in-process job on a scale-to-zero service could
 * simply never fire). Runs daily; each run is one DELETE per table, all
 * independent, all idempotent.
 *
 * `expiresAt` is quoted: the Better-auth tables use case-preserved camelCase
 * identifiers (see db/migrations/1747577000000_auth_studio.cjs and the schema
 * integration test that pins this).
 */

export const AUTH_PRUNE_TABLES = [
  "auth_session",
  "auth_verification",
  "tenant_auth_session",
  "tenant_auth_verification",
] as const;

export type AuthPruneResult = Record<(typeof AUTH_PRUNE_TABLES)[number], number>;

/** Delete rows whose `expiresAt` has passed. Returns deleted-row counts per table. */
export async function pruneExpiredAuthRows(pool: Pool): Promise<AuthPruneResult> {
  const result = {} as AuthPruneResult;
  for (const table of AUTH_PRUNE_TABLES) {
    const res = await pool.query(`DELETE FROM ${table} WHERE "expiresAt" < now()`);
    result[table] = res.rowCount ?? 0;
  }
  return result;
}
