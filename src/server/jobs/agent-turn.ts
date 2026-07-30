import type { Pool } from "pg";
import { runAgentTurn, parsePositiveIntEnv } from "../ai/agent/loop.js";
import {
  setConversationStatus, claimConversationTurn, releaseConversationTurn, appendMessage,
} from "../ai/agent/repo.js";

/**
 * `continuation` (Task A2, incremented by A3 — see
 * docs/superpowers/sdd/2026-07-30-lovable-workspace): a round marker on
 * every AGENT_TURN job payload, starting at 0 for a conversation's very
 * first job (whether enqueued via the wizard's create-with-job path or a
 * chat message POST). `handleAgentTurn` below increments it for each
 * auto-continuation re-enqueue and varies the enqueue `singletonKey` per
 * round (pg-boss's `stately` policy drops a second `send()` with the SAME
 * key while one is still queued/active — see global-constraints.md).
 */
export type AgentTurnInput = { conversationId: string; siteId: string; continuation?: number };

/**
 * Enqueues the next continuation round's AGENT_TURN job. Injectable so
 * tests never need a live pg-boss instance (mirrors admin-ai-agent.ts's
 * `opts.enqueue` pattern). Production wiring is `defaultEnqueueContinuation`
 * below, which reaches `getBoss()`/`AGENT_TURN` via a dynamic import of
 * `./index.js` rather than a static one — jobs/index.ts already imports
 * `handleAgentTurn`/`AgentTurnInput` from THIS module to register the
 * worker, so a static back-import here would be a require cycle.
 */
export type EnqueueContinuation = (input: AgentTurnInput) => Promise<string | null>;

export type AgentTurnDeps = {
  pool: Pool;
  runTurn?: typeof runAgentTurn;
  enqueueContinuation?: EnqueueContinuation;
};

/** Env-tunable cap on auto-continue rounds per user message (Task A3). */
const DEFAULT_MAX_CONTINUATIONS = 3;

/**
 * Task A3 (Lovable-workspace plan) — the continuation `singletonKey`.
 *
 * The plan text specifies `${siteId}:c${continuation}`. Verified against the
 * schema/routes (no unique constraint on `ai_conversations.site_id`,
 * `createConversation` has no "one active conversation per site" guard,
 * `listConversations` returns a list) that a site CAN have more than one
 * concurrent conversation — the "one chat per site" assumption is a UI
 * convention (AgentChatDrawer just grabs the first non-archived one), not an
 * enforced invariant. A bare-siteId continuation key would collide across
 * two unrelated conversations on the same site both reaching the same
 * round under pg-boss's `stately` policy, silently dropping one job's
 * re-enqueue. Keying on `conversationId` instead preserves the required
 * "varies per round" property (so it can never collide with round 0's
 * bare-`conversationId` key from admin-ai-agent.ts) without that collision
 * risk, since `claimConversationTurn`'s lock is itself conversation-scoped.
 */
export function buildContinuationSingletonKey(input: AgentTurnInput): string {
  return `${input.conversationId}:c${input.continuation}`;
}

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
 * Job duplication (item 2, corrected in round 2): `singletonKey` on the
 * enqueueing `send()` call (admin-ai-agent.ts) only dedupes because the
 * `ai.agent-turn` QUEUE is created with `policy: "stately"`
 * (src/server/jobs/index.ts) — pg-boss's default `standard` policy does
 * NOT enforce `singletonKey` at all (empirically verified: two `send()`
 * calls with the same key against a `standard` queue both return distinct
 * job ids; the round-1 version of this comment asserted the opposite).
 * With `stately`, that `singletonKey`+`retryLimit:0` is the PRIMARY defense
 * against two AGENT_TURN jobs for the same conversation ever being
 * queued/active at once, and against pg-boss auto-retrying a failed turn
 * (which would replay already-committed writes — unsafe, since a turn's
 * tool calls are not idempotent). This handler's own claim is the backstop
 * for whatever that doesn't cover (e.g. a manually re-triggered delivery).
 * A `null` `send()` result is now ambiguous (queue down vs. deduped) — see
 * `admin-ai-agent.ts`'s `hasLiveAgentTurnJob` for how the route tells them
 * apart before deciding whether to report 503.
 *
 * Auto-continue (Task A3): a job turn runs with no `limits`, so it can only
 * end `completed` / `tool_limit` / `token_budget` / `error` (never
 * `deadline` — that's route-only, for the inline 45s-cap path). On
 * `tool_limit` with `continuation < AI_AGENT_MAX_CONTINUATIONS` (default 3),
 * this re-enqueues the next round itself rather than surfacing a stall to
 * the user — the model's own "reached the limit" note (persisted by
 * loop.ts) is the last row in history, so the continuation job resumes
 * from it with no new user message needed. At the cap, a user-visible
 * "paused" note is appended instead and the conversation is released to
 * `active` same as any other terminal end.
 */
export async function handleAgentTurn(data: AgentTurnInput, deps: AgentTurnDeps): Promise<void> {
  const runTurn = deps.runTurn ?? runAgentTurn;
  const continuation = data.continuation ?? 0;
  const claimed = await claimConversationTurn(deps.pool, data.conversationId);
  if (!claimed) return; // duplicate/re-delivery — another turn already owns this conversation
  try {
    const result = await runTurn({ pool: deps.pool, conversationId: data.conversationId, siteId: data.siteId });

    if (result.endReason === "tool_limit") {
      const maxContinuations = parsePositiveIntEnv(
        process.env.AI_AGENT_MAX_CONTINUATIONS, DEFAULT_MAX_CONTINUATIONS,
      );
      if (continuation < maxContinuations) {
        // Release BEFORE enqueueing (same ordering as admin-ai-agent.ts's
        // runJobTurn, and for the same reason): holding the 'running' lock
        // across the send() call would leave a gap where the continuation
        // job dequeues and claims before THIS release commits, so a crash
        // between the two could strand the conversation at 'running' with
        // nothing left to release it.
        await releaseConversationTurn(deps.pool, data.conversationId, "active");
        const next: AgentTurnInput = {
          conversationId: data.conversationId,
          siteId: data.siteId,
          continuation: continuation + 1,
        };
        const enqueueContinuation = deps.enqueueContinuation ?? defaultEnqueueContinuation;
        await enqueueContinuation(next);
        return;
      }

      // Cap reached — the loop's own per-round "reached the limit" note
      // (loop.ts) is already in history, but that's silent to the operator
      // unless they're watching the SSE tail. Leave one more, clearly
      // user-facing note explaining why the build stopped short of done.
      await appendMessage(deps.pool, data.conversationId, "assistant", [
        {
          type: "text",
          text: `Paused after ${continuation + 1} batches — send a message to continue.`,
        },
      ]);
      await releaseConversationTurn(deps.pool, data.conversationId, "active");
      return;
    }

    await releaseConversationTurn(deps.pool, data.conversationId, "active");
  } catch (err) {
    await setConversationStatus(deps.pool, data.conversationId, "error").catch(() => undefined);
    throw err;
  }
}

async function defaultEnqueueContinuation(input: AgentTurnInput): Promise<string | null> {
  const { getBoss, AGENT_TURN } = await import("./index.js");
  return getBoss().send(AGENT_TURN, input, {
    singletonKey: buildContinuationSingletonKey(input),
    retryLimit: 0,
  });
}
