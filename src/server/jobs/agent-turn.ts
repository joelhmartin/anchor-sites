import type { Pool } from "pg";
import { runAgentTurn } from "../ai/agent/loop.js";
import { setConversationStatus } from "../ai/agent/repo.js";

export type AgentTurnInput = { conversationId: string; siteId: string };
export type AgentTurnDeps = { pool: Pool; runTurn?: typeof runAgentTurn };

/**
 * pg-boss handler for `ai.agent-turn` (Task 9 — see
 * docs/superpowers/specs/2026-07-27-ai-site-agent-design.md).
 *
 * Build-turn worker: full caps, no deadline (progress persists as ai_messages;
 * the SSE tail reads the DB, so no onEvent wiring here). Errors mark the
 * conversation `error` and rethrow so pg-boss records the failure.
 */
export async function handleAgentTurn(data: AgentTurnInput, deps: AgentTurnDeps): Promise<void> {
  const runTurn = deps.runTurn ?? runAgentTurn;
  try {
    await runTurn({ pool: deps.pool, conversationId: data.conversationId, siteId: data.siteId });
  } catch (err) {
    await setConversationStatus(deps.pool, data.conversationId, "error").catch(() => undefined);
    throw err;
  }
}
