import type { Pool } from "pg";

/**
 * GitHub sync state repository (Task 1 of the GitHub sync plan — see
 * docs/superpowers/specs/2026-07-28-github-sync-design.md). Pool-injected,
 * mirroring src/server/ai/agent/repo.ts style: one row per site, upserted on
 * enable, explicit `updated_at = now()` bumps on every write (no DB trigger —
 * see 1747603000000_site_git_state.cjs for the rationale).
 */
export type SiteGitState = {
  site_id: string;
  enabled: boolean;
  last_export_sha: string | null;
  last_import_sha: string | null;
  last_synced_at: string | null;
  /**
   * @deprecated D616 — the legacy shared error slot. No longer written; read
   * the per-direction `last_export_error` / `last_import_error` instead.
   */
  last_error: string | null;
  /** D616: export-pipeline failure detail; cleared only by a successful export. */
  last_export_error: string | null;
  /** D616: import-pipeline failure/validation detail; cleared only by a successful import. */
  last_import_error: string | null;
  updated_at: string;
};

const COLS = `site_id, enabled, last_export_sha, last_import_sha,
  to_char(last_synced_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS last_synced_at,
  last_error, last_export_error, last_import_error,
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS updated_at`;

const MAX_ERROR_LENGTH = 500;

/** D616 — which pipeline a git error/success belongs to. */
export type GitDirection = "export" | "import";

export async function getGitState(pool: Pool, siteId: string): Promise<SiteGitState | null> {
  const r = await pool.query<SiteGitState>(
    `SELECT ${COLS} FROM site_git_state WHERE site_id = $1`, [siteId],
  );
  return r.rows[0] ?? null;
}

export async function setGitEnabled(
  pool: Pool, siteId: string, enabled: boolean,
): Promise<SiteGitState> {
  const r = await pool.query<SiteGitState>(
    `INSERT INTO site_git_state (site_id, enabled, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (site_id) DO UPDATE SET enabled = $2, updated_at = now()
     RETURNING ${COLS}`,
    [siteId, enabled],
  );
  return r.rows[0];
}

export async function recordExport(pool: Pool, siteId: string, sha: string): Promise<void> {
  // D616: clears ONLY the export error slot — a successful export must not
  // erase an unresolved import validation report.
  await pool.query(
    `INSERT INTO site_git_state (site_id, last_export_sha, last_synced_at, last_export_error, updated_at)
     VALUES ($1, $2, now(), NULL, now())
     ON CONFLICT (site_id) DO UPDATE SET
       last_export_sha = $2, last_synced_at = now(), last_export_error = NULL, updated_at = now()`,
    [siteId, sha],
  );
}

export async function recordImport(pool: Pool, siteId: string, sha: string): Promise<void> {
  // D616: clears ONLY the import error slot — a successful import must not
  // erase an unresolved export failure.
  await pool.query(
    `INSERT INTO site_git_state (site_id, last_import_sha, last_synced_at, last_import_error, updated_at)
     VALUES ($1, $2, now(), NULL, now())
     ON CONFLICT (site_id) DO UPDATE SET
       last_import_sha = $2, last_synced_at = now(), last_import_error = NULL, updated_at = now()`,
    [siteId, sha],
  );
}

/**
 * D616: record a failure against ONE pipeline's error slot. `direction`
 * decides which column is written; the other direction's slot (and any
 * unresolved error in it) is left untouched.
 */
export async function recordGitError(
  pool: Pool,
  siteId: string,
  direction: GitDirection,
  message: string,
): Promise<void> {
  const truncated = message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
  const col = direction === "export" ? "last_export_error" : "last_import_error";
  await pool.query(
    `INSERT INTO site_git_state (site_id, ${col}, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (site_id) DO UPDATE SET ${col} = $2, updated_at = now()`,
    [siteId, truncated],
  );
}
