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
  status: "active" | "error" | "archived";
  token_usage: Record<string, { input: number; output: number }>;
  created_at: string;
  updated_at: string;
};
export type AiMessageRole = "user" | "assistant" | "tool";
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

export async function getConversation(
  pool: Pool, id: string, siteId: string,
): Promise<AiConversation | null> {
  const r = await pool.query<AiConversation>(
    `SELECT ${CONV_COLS} FROM ai_conversations WHERE id = $1 AND site_id = $2`, [id, siteId],
  );
  return r.rows[0] ?? null;
}

export async function listConversations(pool: Pool, siteId: string): Promise<AiConversation[]> {
  // NOTE: ORDER BY must reference the qualified table column, not the bare
  // "updated_at" name — CONV_COLS aliases that name to a to_char'd (ms-
  // truncated) string, and Postgres's ORDER BY prefers a matching SELECT-list
  // output alias over the real column for a bare identifier. Sorting on the
  // truncated string instead of the real timestamptz made ordering flaky
  // whenever two rows landed in the same millisecond.
  const r = await pool.query<AiConversation>(
    `SELECT ${CONV_COLS} FROM ai_conversations WHERE site_id = $1 ORDER BY ai_conversations.updated_at DESC`,
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

export async function setConversationStatus(
  pool: Pool, id: string, status: AiConversation["status"],
): Promise<void> {
  await pool.query(`UPDATE ai_conversations SET status = $2 WHERE id = $1`, [id, status]);
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
