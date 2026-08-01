import type { Pool } from "pg";

/**
 * AI agent conversation repository (Task 1 of the AI site agent — see
 * docs/superpowers/specs/2026-07-27-ai-site-agent-design.md). Pool-injected,
 * mirroring src/server/blog/repo.ts style; every query is scoped by
 * `site_id` (multi-tenant) except message queries, which are scoped by
 * `conversation_id` (conversations are already site-scoped at creation).
 */
export type AiConversation = {
  id: string;
  site_id: string;
  title: string;
  /** `stopped` (W1.4 / D300+D1105+D612): an operator-cancelled turn's honest
   * terminal state — nothing failed ('error' would lie), nothing completed
   * ('active' would lie). Claimable again like 'error' (a message resumes).
   *
   * KNOWN AXIS DEBT (W2-CONC / D621, deliberately not remodeled): this one
   * enum multiplexes three axes — a turn MUTEX (`running`), a HEALTH flag
   * (`error`/`stopped`), and a LIFECYCLE (`active`/`archived`). The two
   * concrete hazards that multiplexing creates are guarded below rather than
   * split into columns: (a) no release/terminal write may downgrade
   * `archived` (every status-writing function carries a
   * `status <> 'archived'` predicate), and (b) archiving refuses while a
   * turn is running (`archiveConversation`). A full split (lock →
   * `claim_seq`+lease column, lifecycle → its own column) is the W2-TERM
   * archive surface's prerequisite work, not this milestone's. */
  status: "active" | "error" | "archived" | "running" | "stopped";
  token_usage: Record<string, { input: number; output: number }>;
  created_at: string;
  updated_at: string;
};
/**
 * `system` (W1.4 / D601+D303+D1103): a UI-only transcript annotation — e.g.
 * "Build was interrupted — press Resume to continue." Rendered as the amber
 * SystemLine in the chat client (src/admin/components/agent-chat/history.ts)
 * and NEVER replayed into the Anthropic context (loop.ts's buildApiMessages
 * filters it out — the API has no such role and the model shouldn't see
 * infrastructure notes as conversation content).
 */
export type AiMessageRole = "user" | "assistant" | "tool" | "system";
export type AiMessage = {
  id: string;
  conversation_id: string;
  role: AiMessageRole;
  content: unknown;
  created_at: string;
};

const CONV_COLS = `id, site_id, title, status, token_usage,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS created_at,
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS updated_at`;

const MSG_COLS = `id, conversation_id, role, content,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSZ') AS created_at`;

export async function createConversation(
  pool: Pool, siteId: string, title: string,
): Promise<AiConversation> {
  const r = await pool.query<AiConversation>(
    `INSERT INTO ai_conversations (site_id, title) VALUES ($1, $2) RETURNING ${CONV_COLS}`,
    [siteId, title],
  );
  return r.rows[0];
}

/**
 * W2-CONC / D302 — server-side get-or-create: ONE live conversation per
 * site. Returns the site's existing non-archived conversation (whatever its
 * status — active/error/running/stopped are all "the" conversation; W1.4's
 * 'stopped' included) instead of minting a twin. The INSERT's ON CONFLICT
 * arbiter is the `ai_conversations_one_active_per_site` partial unique
 * index, so two tabs racing this converge on the same row: the loser's
 * INSERT returns nothing and the follow-up SELECT finds the winner's row.
 *
 * The final re-SELECT can only come up empty if the winner's conversation
 * was archived in the microseconds between our INSERT and SELECT — one
 * retry loop iteration covers it rather than surfacing a spurious 500.
 */
export async function getOrCreateConversation(
  pool: Pool, siteId: string, title: string,
): Promise<{ conversation: AiConversation; created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await pool.query<AiConversation>(
      `SELECT ${CONV_COLS} FROM ai_conversations WHERE site_id = $1 AND status <> 'archived' LIMIT 1`,
      [siteId],
    );
    if (existing.rows[0]) return { conversation: existing.rows[0], created: false };

    const inserted = await pool.query<AiConversation>(
      `INSERT INTO ai_conversations (site_id, title) VALUES ($1, $2)
       ON CONFLICT (site_id) WHERE status <> 'archived' DO NOTHING
       RETURNING ${CONV_COLS}`,
      [siteId, title],
    );
    if (inserted.rows[0]) return { conversation: inserted.rows[0], created: true };
    // Lost the race — loop back to pick up the winner's row.
  }
  throw new Error(`conversation get-or-create kept racing for site ${siteId}`);
}

export async function getConversation(
  pool: Pool, id: string, siteId: string,
): Promise<AiConversation | null> {
  const r = await pool.query<AiConversation>(
    `SELECT ${CONV_COLS} FROM ai_conversations WHERE id = $1 AND site_id = $2`, [id, siteId],
  );
  return r.rows[0] ?? null;
}

export async function listConversations(
  pool: Pool, siteId: string, opts: { includeArchived?: boolean } = {},
): Promise<AiConversation[]> {
  // NOTE: ORDER BY must reference the qualified table column, not the bare
  // "updated_at" name — CONV_COLS aliases that name to a to_char'd (ms-
  // truncated) string, and Postgres's ORDER BY prefers a matching SELECT-list
  // output alias over the real column for a bare identifier. Sorting on the
  // truncated string instead of the real timestamptz made ordering flaky
  // whenever two rows landed in the same millisecond.
  //
  // D517/D324 (W2-TERM): archived conversations are hidden by default — the
  // workspace bootstrap and default listing show only the ONE live
  // conversation (D302's one-per-site invariant). The history surface passes
  // `includeArchived` to see retired threads.
  const r = await pool.query<AiConversation>(
    `SELECT ${CONV_COLS} FROM ai_conversations
      WHERE site_id = $1 ${opts.includeArchived ? "" : "AND status <> 'archived'"}
      ORDER BY ai_conversations.updated_at DESC`,
    [siteId],
  );
  return r.rows;
}

export async function appendMessage(
  pool: Pool, conversationId: string, role: AiMessageRole, content: unknown,
): Promise<AiMessage> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<AiMessage>(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, $2, $3::jsonb) RETURNING ${MSG_COLS}`,
      [conversationId, role, JSON.stringify(content)],
    );
    await client.query(
      `UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, [conversationId],
    );
    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMessages(
  pool: Pool, conversationId: string, opts: { limit?: number; afterId?: string } = {},
): Promise<AiMessage[]> {
  // NOTE (see listConversations): ORDER BY must reference the qualified
  // table/subquery column, not the bare "created_at" name — MSG_COLS aliases
  // that name to a to_char'd (ms-truncated) string.
  if (opts.afterId) {
    const r = await pool.query<AiMessage>(
      `SELECT ${MSG_COLS} FROM ai_messages
       WHERE conversation_id = $1
         AND (created_at, id) > (SELECT created_at, id FROM ai_messages WHERE id = $2)
       ORDER BY ai_messages.created_at ASC, ai_messages.id ASC`,
      [conversationId, opts.afterId],
    );
    return r.rows;
  }
  if (opts.limit) {
    const r = await pool.query<AiMessage>(
      `SELECT ${MSG_COLS} FROM (
         SELECT * FROM ai_messages WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2
       ) t ORDER BY t.created_at ASC, t.id ASC`,
      [conversationId, opts.limit],
    );
    return r.rows;
  }
  const r = await pool.query<AiMessage>(
    `SELECT ${MSG_COLS} FROM ai_messages
     WHERE conversation_id = $1 ORDER BY ai_messages.created_at ASC, ai_messages.id ASC`,
    [conversationId],
  );
  return r.rows;
}

/**
 * W1.5 / D1106 — the conversation's FOUNDING user message (the business
 * brief that started it all). `buildApiMessages` (loop.ts) windows history
 * to a 40-row tail, and a single build turn can persist 61 rows, so after
 * one build the original description would otherwise be permanently outside
 * every future model context. Ordered `(created_at, id)` for the same
 * tie-break reason as `listMessages` above.
 */
export async function getFoundingUserMessage(
  pool: Pool, conversationId: string,
): Promise<AiMessage | null> {
  const r = await pool.query<AiMessage>(
    `SELECT ${MSG_COLS} FROM ai_messages
     WHERE conversation_id = $1 AND role = 'user'
     ORDER BY ai_messages.created_at ASC, ai_messages.id ASC LIMIT 1`,
    [conversationId],
  );
  return r.rows[0] ?? null;
}

/**
 * D621 guard (a): a plain status write never downgrades `archived` — archived
 * is terminal for every writer except an explicit future unarchive function.
 * D1119: pass `opts.ifClaimToken` (from `claimConversationTurn`) to make the
 * write a fenced one — it no-ops if the claim was superseded by a takeover.
 */
export async function setConversationStatus(
  pool: Pool, id: string, status: AiConversation["status"],
  opts: { ifClaimToken?: ClaimToken } = {},
): Promise<void> {
  await pool.query(
    `UPDATE ai_conversations SET status = $2
     WHERE id = $1 AND status <> 'archived'
       AND ($3::bigint IS NULL OR claim_seq = $3::bigint)`,
    [id, status, opts.ifClaimToken ?? null],
  );
}

/**
 * D621 guard (b): archive is the lifecycle's terminal transition and must
 * not land mid-turn — a running build writing into an archived conversation
 * is undefined territory (and the D302 unique index would let a NEW
 * conversation be created while the old build still runs). Refuses while
 * `running`; returns whether the archive landed. The future archive
 * route/tool (W2-TERM D108/D517) must go through this, never a bare UPDATE.
 */
export async function archiveConversation(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE ai_conversations SET status = 'archived', cancel_requested = false
     WHERE id = $1 AND status <> 'running'
     RETURNING id`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Turn-serialization lock (bot-review fix wave, item 1 — Codex P1). Atomically
 * flips a conversation to `status='running'` so only one turn can be
 * in-flight at a time: a second concurrent claim attempt sees a row already
 * `running` (and not stale) and gets zero rows back. `status IN ('active',
 * 'error')` covers the normal "nothing running" states; the `running AND
 * updated_at < now() - 10m` branch is a takeover for a turn that crashed
 * without releasing (the job path has no request timeout to guarantee a
 * release, and appendMessage bumps `updated_at` on every persisted message,
 * so a genuinely active turn keeps re-arming this window well under 10
 * minutes). Returns true iff THIS call won the claim.
 *
 * Round 2 fix, item 4 (Minor): the UPDATE also bumps `updated_at` to `now()`
 * at claim time, not just on the first `appendMessage` afterward — a job can
 * sit queued for a while before pg-boss dequeues it (e.g. under load, or
 * behind other queued turns), and without this, that queued time counts
 * against the 10-minute stale-takeover window. A long-queued-but-not-yet-
 * started job could otherwise become "stale" and get its lock stolen out
 * from under it before its first model call ever persists anything.
 *
 * W2-CONC / D1119 — fencing token. The lock is stealable (the stale-takeover
 * branch), so every successful claim now increments `claim_seq` and returns
 * the new value as this claim's TOKEN (a string — node-postgres returns
 * bigint as text). Fenced writes (`releaseConversationTurn`,
 * `markConversationStopped`, `setConversationStatus` with `ifClaimToken`)
 * compare it and no-op when superseded: a worker that hung past the
 * 10-minute window, lost its claim to a takeover, and then woke up can no
 * longer release the NEWER claimant's `running` back to `active` (which
 * would have let two turns interleave writes + Anthropic history). Returns
 * `null` iff the claim was not won.
 */
export type ClaimToken = string;

export async function claimConversationTurn(pool: Pool, id: string): Promise<ClaimToken | null> {
  // 'stopped' joins 'error' in the claimable set (W1.4 Stop): a follow-up
  // message after an operator cancel IS the resume.
  const r = await pool.query<{ claim_seq: string }>(
    `UPDATE ai_conversations SET status = 'running', updated_at = now(), claim_seq = claim_seq + 1
     WHERE id = $1
       AND (status IN ('active','error','stopped') OR (status = 'running' AND updated_at < now() - interval '10 minutes'))
     RETURNING claim_seq::text AS claim_seq`,
    [id],
  );
  return r.rows[0]?.claim_seq ?? null;
}

/**
 * Releases the turn-serialization lock. `status:"active"` is a CONDITIONAL
 * update (only while still `running`) so it never clobbers an `error` status
 * some other code path already set for this same turn (the loop's failure-
 * streak/budget-exhaustion branches, or the route's own catch block) — those
 * already-set statuses win over this best-effort "done" flip.
 *
 * D1119: `claimToken` (when the caller holds one) fences BOTH branches — a
 * release from a superseded claim no-ops instead of flipping the newer
 * claimant's `running`. D621 guard (a): the `error` branch, which used to be
 * a bare unconditional UPDATE, now also refuses to downgrade `archived`.
 */
export async function releaseConversationTurn(
  pool: Pool, id: string, status: "active" | "error", claimToken?: ClaimToken,
): Promise<void> {
  // Both branches also clear `cancel_requested` (W1.4 Stop): a Stop that
  // lost the race against the turn's natural end must not linger and cancel
  // the NEXT, unrelated turn.
  if (status === "active") {
    await pool.query(
      `UPDATE ai_conversations SET status = 'active', cancel_requested = false
       WHERE id = $1 AND status = 'running'
         AND ($2::bigint IS NULL OR claim_seq = $2::bigint)`,
      [id, claimToken ?? null],
    );
  } else {
    await pool.query(
      `UPDATE ai_conversations SET status = 'error', cancel_requested = false
       WHERE id = $1 AND status <> 'archived'
         AND ($2::bigint IS NULL OR claim_seq = $2::bigint)`,
      [id, claimToken ?? null],
    );
  }
}

// ---------------------------------------------------------------------------
// W1.4 / D300+D1105+D612 — real Stop. The route sets `cancel_requested`; the
// turn loop / job handler consume it at batch boundaries and between tool
// calls, then land the conversation in the honest 'stopped' terminal state.
// ---------------------------------------------------------------------------

export const STOPPED_NOTE = "Stopped by you — the site keeps whatever was already written.";

/**
 * Marks the conversation as cancellation-requested. Only meaningful while a
 * turn is running or queued (`running`/`active`); returns false for settled
 * states so the route can answer honestly ("nothing to stop").
 */
export async function requestConversationStop(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE ai_conversations SET cancel_requested = true
     WHERE id = $1 AND status IN ('running','active')
     RETURNING id`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Atomic report-and-clear of the cancel flag — exactly one consumer acts on
 * any single Stop click, however many checks race.
 */
export async function consumeCancelRequest(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE ai_conversations SET cancel_requested = false
     WHERE id = $1 AND cancel_requested
     RETURNING id`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Lands a consumed cancel: appends the honest transcript note, then flips to
 * 'stopped' (clearing any re-set flag). Note first, status second — the SSE
 * tail applies a terminal status immediately on the client, so the note must
 * already be in the DB when the status flip streams out.
 *
 * D1119: with a `claimToken`, both the note and the flip are skipped when
 * the claim was superseded (pre-check) and the flip itself is fenced — a
 * hung worker's late "stopped" can't overwrite the newer claimant's turn.
 * The pre-check-then-write pair leaves a microscopic window where only the
 * note lands (a stray transcript line, no state damage) — acceptable for
 * the minimal fence; the STATUS write is the one that's atomic-guarded.
 */
export async function markConversationStopped(
  pool: Pool, id: string, claimToken?: ClaimToken,
): Promise<void> {
  if (claimToken !== undefined) {
    const check = await pool.query<{ claim_seq: string; status: string }>(
      `SELECT claim_seq::text AS claim_seq, status FROM ai_conversations WHERE id = $1`,
      [id],
    );
    const row = check.rows[0];
    if (!row || row.claim_seq !== claimToken || row.status === "archived") return;
  }
  await appendMessage(pool, id, "system", [{ type: "text", text: STOPPED_NOTE }]);
  await pool.query(
    `UPDATE ai_conversations SET status = 'stopped', cancel_requested = false
     WHERE id = $1 AND status <> 'archived'
       AND ($2::bigint IS NULL OR claim_seq = $2::bigint)`,
    [id, claimToken ?? null],
  );
}

/**
 * W1.4 / D601+D309+D1103 — active reconciliation for builds that died
 * silently. Two stranded shapes, both otherwise invisible until an operator
 * happens to send another message:
 *
 *  - "interrupted": a worker death mid-turn leaves `status='running'`
 *    forever. The ONLY recovery used to be the lazy claim takeover in
 *    `claimConversationTurn` (>10 min stale), which requires a NEW message —
 *    meanwhile the workspace shows a busy build indefinitely. The staleness
 *    window here is the SAME 10 minutes as that takeover (a genuinely active
 *    turn re-arms `updated_at` on every persisted message, well under 10
 *    minutes even for slow model calls).
 *
 *  - "never_started": a message was appended and its AGENT_TURN job enqueued
 *    (202 to the client), but no worker ever picked it up — the conversation
 *    sits `active` with an unanswered trailing user message and the client's
 *    `sending` spinner runs forever. 5 minutes is comfortably past pg-boss's
 *    ~2s poll while still bounded; NOTE pg-boss works AGENT_TURN jobs one at
 *    a time, so a job queued behind another conversation's very long build
 *    can false-positive — that's self-healing (the sweep flips to 'error',
 *    the late job's own claim re-claims from 'error' and runs normally), and
 *    the honest "hasn't started" note beats an infinite spinner.
 *
 * Both flips are atomic single-statement UPDATEs guarded by the same
 * predicate that selects them, so N concurrent tail pollers produce exactly
 * one flip + one transcript row. Called from the SSE tail's poll loop
 * (admin-ai-agent.ts) — the reconciler runs wherever someone is watching,
 * which is exactly where the strand is visible.
 */
export const RUNNING_STALE_MINUTES = 10;
export const QUEUED_STALL_MINUTES = 5;

export type StallSweepResult = "interrupted" | "never_started" | null;

export async function sweepStalledConversation(
  pool: Pool, id: string,
): Promise<StallSweepResult> {
  const interrupted = await pool.query(
    `UPDATE ai_conversations SET status = 'error'
     WHERE id = $1 AND status = 'running'
       AND updated_at < now() - make_interval(mins => $2)
     RETURNING id`,
    [id, RUNNING_STALE_MINUTES],
  );
  if ((interrupted.rowCount ?? 0) > 0) {
    await appendMessage(pool, id, "system", [
      { type: "text", text: "Build was interrupted — press Resume to continue." },
    ]);
    return "interrupted";
  }

  const neverStarted = await pool.query(
    `UPDATE ai_conversations c SET status = 'error'
     WHERE c.id = $1 AND c.status = 'active'
       AND c.updated_at < now() - make_interval(mins => $2)
       AND (SELECT m.role FROM ai_messages m WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'user'
     RETURNING id`,
    [id, QUEUED_STALL_MINUTES],
  );
  if ((neverStarted.rowCount ?? 0) > 0) {
    await appendMessage(pool, id, "system", [
      { type: "text", text: "The build never started — the job queue may be down. Press Resume to try again." },
    ]);
    return "never_started";
  }

  return null;
}

export async function addTokenUsage(
  pool: Pool, id: string, usage: { input: number; output: number },
  day: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  // Read-modify-write under FOR UPDATE; turns are sequential per conversation
  // so contention is theoretical, but the lock makes the math safe anyway.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ token_usage: Record<string, { input: number; output: number }> }>(
      `SELECT token_usage FROM ai_conversations WHERE id = $1 FOR UPDATE`, [id],
    );
    if (r.rows[0]) {
      const tu = r.rows[0].token_usage ?? {};
      const cur = tu[day] ?? { input: 0, output: 0 };
      tu[day] = { input: cur.input + usage.input, output: cur.output + usage.output };
      await client.query(
        `UPDATE ai_conversations SET token_usage = $2::jsonb WHERE id = $1`,
        [id, JSON.stringify(tu)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function getTodayUsage(
  conv: AiConversation, day: string = new Date().toISOString().slice(0, 10),
): { input: number; output: number } {
  return conv.token_usage?.[day] ?? { input: 0, output: 0 };
}
