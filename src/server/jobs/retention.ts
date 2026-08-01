import type { Pool } from "pg";

/**
 * W2-TERM retention sweeps — bound two append-only tables that grew forever.
 * Same scheduled-cron pattern as auth-prune / media-gc (see jobs/index.ts):
 * idempotent, safe to re-run, log only when they act.
 *
 *  - D506 `sweepPageRevisions`: page_revisions is append-only — every save,
 *    restore, per-page bulk-publish, template materialize, and git import
 *    inserts a row, with no pruning anywhere. Policy: keep the newest
 *    REVISION_KEEP_N (50) revisions per page ALWAYS, and of the rest keep any
 *    younger than REVISION_AGE_CAP_DAYS (90). A revision is deleted only when
 *    it is BOTH beyond the newest 50 for its page AND older than 90 days — so
 *    a burst of edits today is never lost, and deep history is only trimmed
 *    once it's both stale and superseded. (page_revisions has no FK the delete
 *    would violate; nothing references a revision by id except the restore
 *    route, which only ever offers the retained recent ones.)
 *
 *  - D518 `sweepAiMessages`: ai_messages holds full page copy, operator
 *    prompts, and tool results indefinitely. Retention is tied to conversation
 *    archival (D517): once a conversation is `archived` and has had no
 *    activity for AI_MESSAGE_RETENTION_DAYS (90) — its `updated_at` is frozen
 *    at last activity, nothing bumps it after archival — its message content
 *    is purged. The conversation ROW is kept (its title still lists in the
 *    history surface); only the heavyweight transcript is dropped.
 */

export const REVISION_KEEP_N = 50;
export const REVISION_AGE_CAP_DAYS = 90;
export const AI_MESSAGE_RETENTION_DAYS = 90;

export const PAGE_REVISION_SWEEP = "retention.page-revisions";
export const AI_MESSAGE_SWEEP = "retention.ai-messages";

/** D506 — delete revisions beyond the newest N per page AND older than the age cap. */
export async function sweepPageRevisions(
  pool: Pool,
  opts: { keepN?: number; ageCapDays?: number } = {},
): Promise<{ deleted: number }> {
  const keepN = opts.keepN ?? REVISION_KEEP_N;
  const ageCapDays = opts.ageCapDays ?? REVISION_AGE_CAP_DAYS;
  const res = await pool.query(
    `DELETE FROM page_revisions pr
      USING (
        SELECT id,
               row_number() OVER (PARTITION BY page_id ORDER BY created_at DESC, id DESC) AS rn
          FROM page_revisions
      ) ranked
      WHERE pr.id = ranked.id
        AND ranked.rn > $1
        AND pr.created_at < now() - make_interval(days => $2::int)`,
    [keepN, ageCapDays],
  );
  return { deleted: res.rowCount ?? 0 };
}

/** D518 — purge message content of long-archived conversations (keeps the row). */
export async function sweepAiMessages(
  pool: Pool,
  opts: { retentionDays?: number } = {},
): Promise<{ deleted: number }> {
  const retentionDays = opts.retentionDays ?? AI_MESSAGE_RETENTION_DAYS;
  const res = await pool.query(
    `DELETE FROM ai_messages m
      USING ai_conversations c
      WHERE m.conversation_id = c.id
        AND c.status = 'archived'
        AND c.updated_at < now() - make_interval(days => $1::int)`,
    [retentionDays],
  );
  return { deleted: res.rowCount ?? 0 };
}
