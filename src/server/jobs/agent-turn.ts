import type { Pool } from "pg";
import { runAgentTurn } from "../ai/agent/loop.js";
import { setConversationStatus, claimConversationTurn, releaseConversationTurn } from "../ai/agent/repo.js";

export type AgentTurnInput = { conversationId: string; siteId: string };
export type AgentTurnDeps = { pool: Pool; runTurn?: typeof runAgentTurn };

/**
 * pg-boss handler for `ai.agent-turn` (Task 9 — see
 * docs/superpowers/specs/2026-07-27-ai-site-agent-design.md; turn-lock
 * behavior added by the bot-review fix wave, items 1+2).
 *
 * Build-turn worker: full caps, no deadline (progress persists as ai_messages;
 * the SSE tail reads the DB, so no onEvent wiring here). Errors mark the
 * conversation `error` and rethrow so pg-boss records the failure.
 *
 * Turn serialization (item 1): claims the same `status='running'` lock the
 * HTTP routes use (src/server/routes/admin-ai-agent.ts) and HOLDS it for
 * this turn's full execution, releasing to 'active' on success. This is
 * what actually closes the race the fix targets — a later inline message
 * POST arriving while a job-run build is still in progress sees `running`
 * and gets a 409 (the enqueuing route itself only holds the lock briefly
 * around the `send()` call, then hands ownership to this handler). A failed
 * claim (conversation already `running` and not stale) means this delivery
 * is a duplicate — return without running rather than replaying turn side
 * effects that already partially committed.
 *
 * Job duplication (item 2): `singletonKey`+`retryLimit:0` on the enqueueing
 * `send()` call (admin-ai-agent.ts) is the PRIMARY defense against two
 * AGENT_TURN jobs for the same conversation ever being queued/active at
 * once, and against pg-boss auto-retrying a failed turn (which would replay
 * already-committed writes — unsafe, since a turn's tool calls are not
 * idempotent). This handler's own claim is the backstop for whatever that
 * doesn't cover (e.g. a manually re-triggered delivery).
 */
export async function handleAgentTurn(data: AgentTurnInput, deps: AgentTurnDeps): Promise<void> {
  const runTurn = deps.runTurn ?? runAgentTurn;
  const claimed = await claimConversationTurn(deps.pool, data.conversationId);
  if (!claimed) return; // duplicate/re-delivery — another turn already owns this conversation
  try {
    await runTurn({ pool: deps.pool, conversationId: data.conversationId, siteId: data.siteId });
    await releaseConversationTurn(deps.pool, data.conversationId, "active");
  } catch (err) {
    await setConversationStatus(deps.pool, data.conversationId, "error").catch(() => undefined);
    throw err;
  }
}
