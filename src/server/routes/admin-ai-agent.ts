import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import {
  createConversation,
  getConversation,
  listConversations,
  appendMessage,
  listMessages,
  claimConversationTurn,
  releaseConversationTurn,
} from "../ai/agent/repo.js";
import { getBoss, AGENT_TURN } from "../jobs/index.js";
import type { AgentTurnInput } from "../jobs/agent-turn.js";

/**
 * Agent HTTP API (Task 10 — see docs/superpowers/specs/2026-07-27-ai-site-agent-design.md
 * and docs/ai-agent.md "Turn lifecycle" / "SSE event types"). Exposes Task 1's
 * repo + Task 8's loop + Task 9's job to the Studio chat drawer
 * (`src/admin/components/AgentChatDrawer.tsx`, `src/admin/lib/agent-api.ts`) —
 * this file is the CONSUMER of that already-built client contract, not a new
 * design: route shapes, SSE event shapes, and the tail's snapshot/afterId
 * semantics all mirror what the drawer already expects.
 *
 * Task A2 (2026-07-30 lovable-workspace SDD) removed the inline turn path:
 * Cloud Run's 60s request timeout means no HTTP request may run an agent
 * loop in-process (global-constraints.md). Every turn — the first message
 * in a conversation, a resume, all of it — now enqueues an AGENT_TURN job
 * and returns immediately. One SSE producer remains:
 *   - `GET .../events` tails a conversation from the DB (there's no
 *     in-request `onEvent` to stream for a job-run turn) — polls
 *     `ai_messages`/`ai_conversations` and re-emits new rows as
 *     `AgentTailEvent`s. The client (`streamAgentEvents` in agent-api.ts)
 *     starts this right after a message POST's 202.
 */

// ---------------------------------------------------------------------------
// SSE + query-token helpers (exported for the preview endpoint — admin-pages.ts).
// ---------------------------------------------------------------------------

export function sseInit(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/**
 * Fix round 1 (reviewer extra #3): guard against writing to a socket the
 * client already tore down. `writableEnded` is set once `res.end()` has run
 * (our own inline-route close handler + the tail route's cleanup both leave
 * it unset on a client-initiated disconnect, so the inline route ALSO tracks
 * its own `clientGone` flag — this guard is the second, cheaper line of
 * defense that protects every caller, including the tail route's poll/heartbeat
 * writes, for free).
 */
export function sseSend(res: Response, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** iframes/EventSource can't set headers; lift ?token= into the header requireAdmin reads. */
export function tokenFromQuery(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers["x-admin-token"] && typeof req.query.token === "string") {
    req.headers["x-admin-token"] = req.query.token;
  }
  next();
}

const createConversationPayload = z.object({
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).optional(),
  run: z.enum(["inline", "job"]).optional(),
});

const postMessagePayload = z.object({
  message: z.string().min(1),
});

function invalidPayload(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: "invalid payload",
    details: error.errors.map((e) => ({
      path: e.path.join(".") || "(root)",
      message: e.message,
    })),
  });
}

export type AdminAiAgentOptions = {
  pool?: Pool;
  /** Injectable for tests. Default: lazy `getBoss().send(AGENT_TURN, input)`, swallowing failures to `null`. */
  enqueue?: (input: AgentTurnInput) => Promise<string | null>;
  /**
   * Injectable for tests. Default: a direct read of pg-boss's own job table
   * (see the comment on `runJobTurn` below for why). Distinguishes "enqueue
   * returned null because pg-boss deduped it" (a live job already
   * queued/active for this conversation — fine) from "enqueue returned null
   * because the queue is down" (getBoss() threw — a real failure).
   */
  hasLiveAgentTurnJob?: (conversationId: string) => Promise<boolean>;
  /** Rate limit for message-sending routes (both cost model spend). Default 10/min. */
  messageRateLimit?: RateLimitOptions;
};

export function adminAiAgentRouter(opts: AdminAiAgentOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();
  const enqueue: (input: AgentTurnInput) => Promise<string | null> =
    opts.enqueue ??
    (async (input) => {
      try {
        // Item 2 (CodeRabbit — job duplication). Round 2 fix: `singletonKey`
        // only dedupes under a queue policy that enforces it — pg-boss's
        // DEFAULT `standard` policy does NOT (empirically verified: two
        // `send()` calls with the same `singletonKey` against a `standard`
        // queue both return distinct job ids). `AGENT_TURN` is created with
        // `policy: "stately"` (src/server/jobs/index.ts) specifically so
        // this actually stops pg-boss from ever having two AGENT_TURN jobs
        // for the same conversation queued/active at once (defense in depth
        // alongside the DB-level `running` claim below) — a second `send()`
        // for a conversation that already has one queued/active now
        // genuinely returns `null` (see `runJobTurn`'s null-handling for
        // why that's not automatically a failure). `retryLimit: 0` because a
        // turn's tool calls commit real side effects (page writes, image
        // imports) as they go — an automatic pg-boss retry would replay
        // already-committed work, which is unsafe, not idempotent.
        return await getBoss().send(AGENT_TURN, input, {
          singletonKey: input.conversationId,
          retryLimit: 0,
        });
      } catch (err) {
        // Fix round 1 (reviewer Important #1): getBoss() throws whenever
        // pg-boss hasn't booted (JOBS_ENABLED=false, or booting failed at
        // startup) — that's a real operational failure, not a quiet no-op.
        // Log it here (codebase idiom: tagged console.error, matching
        // src/server/jobs/index.ts:102 and admin-sites.ts's CRM best-effort
        // logs — no route in this codebase uses req.log for this).
        // eslint-disable-next-line no-console
        console.error("[agent] pg-boss enqueue failed", err);
        return null;
      }
    });
  const hasLiveAgentTurnJob: (conversationId: string) => Promise<boolean> =
    opts.hasLiveAgentTurnJob ??
    (async (conversationId) => {
      // Round 2 fix, item 1: pg-boss's public API has no "is a job with
      // this singletonKey already queued/active?" query — the closest,
      // `getQueues`/`fetch`, aren't scoped per-key. pg-boss owns a schema
      // (default `pgboss`, unconfigured here — see jobs/index.ts's `new
      // PgBoss({ connectionString })`) in the SAME database this `pool`
      // points at, so a direct read of its `job` table is the simplest
      // robust way to answer this. Scoped to the exact states a `stately`-
      // policy queue would still be holding a queued/active job in
      // (`created`/`retry` = queued-ish, `active` = running); `completed`/
      // `cancelled`/`failed` don't count — those aren't "live".
      try {
        const r = await pool.query(
          `SELECT 1 FROM pgboss.job WHERE name = $1 AND singleton_key = $2 AND state IN ('created','active','retry') LIMIT 1`,
          [AGENT_TURN, conversationId],
        );
        return (r.rowCount ?? 0) > 0;
      } catch {
        // The `pgboss` schema doesn't exist (jobs never booted — dev/test
        // without JOBS_ENABLED, or a brand-new database) — there's nothing
        // to find, so this genuinely can't be a dedupe; let the caller fall
        // through to its "queue unavailable" branch.
        return false;
      }
    });
  const messageLimiter = rateLimit(opts.messageRateLimit ?? { max: 10, windowMs: 60_000 });

  /**
   * Shared body for the two job-enqueuing paths (conversation-create-with-job
   * below, and every message POST further down — Task A2 made ALL message
   * turns job-only): claim the turn lock, append the user message, then
   * enqueue. Writes the response
   * itself; callers `return` right after calling this (matches the early-
   * return style used throughout this file).
   *
   * Round 2 fix, item 2 (Important — silent lost-build window): the lock is
   * released BEFORE calling `enqueue`, not after. Holding it ACROSS the
   * enqueue call was the round-1 shape, and it has a real gap: if a worker
   * dequeues and attempts its own claim in between pg-boss accepting the
   * `send()` and this route's post-enqueue release actually committing,
   * that claim fails against the route's still-held lock (claiming only
   * succeeds from `active`/`error`/stale-`running`) — but pg-boss still
   * marks the delivery complete. The initial build then silently never
   * runs, with no error surfaced anywhere. Releasing first closes that gap
   * entirely: by the time the job is ever dequeued, the conversation is
   * already back to `active`, so the job's own claim (agent-turn.ts) always
   * succeeds.
   *
   * Round 2 fix, item 3 (Minor — exception between claim and append leaks
   * the lock for 10 minutes): the append is wrapped so ANY throw releases
   * the claim (to `error`) before propagating, instead of leaving the
   * conversation stuck at `running` until the stale-takeover window.
   *
   * DEFERRED (noted, not implemented — low probability): this claim has no
   * fencing/lease token. A worker whose claim was itself invalidated by a
   * stale-takeover (it hung past the 10-minute window, another delivery
   * took over) could still run to completion and call `releaseConversationTurn`,
   * incorrectly flipping the NEWER claim's `running` back to `active`
   * before ITS turn finishes. Recorded here rather than fixed — closing it
   * fully needs a lease token threaded through claim/release.
   */
  async function runJobTurn(
    res: Response,
    input: { conversationId: string; siteId: string; message: string },
    extraOnSuccess: Record<string, unknown> = {},
  ): Promise<void> {
    const { conversationId, siteId, message } = input;

    const claimed = await claimConversationTurn(pool, conversationId);
    if (!claimed) {
      res.status(409).json({ error: "turn already running" });
      return;
    }

    let userMessageId: string;
    try {
      const appended = await appendMessage(pool, conversationId, "user", [{ type: "text", text: message }]);
      userMessageId = appended.id;
    } catch (err) {
      await releaseConversationTurn(pool, conversationId, "error").catch(() => undefined);
      throw err;
    }

    await releaseConversationTurn(pool, conversationId, "active");

    // `continuation: 0` — this is round 0 of the conversation's AGENT_TURN
    // job chain (Task A2). A3 increments it on re-enqueued continuations
    // and varies `singletonKey` per round; not implemented here.
    const jobId = await enqueue({ conversationId, siteId, continuation: 0 });
    // Fix round 1 (Finding 1 — reviewer): every success/dedupe response
    // carries the just-appended user message's real, persisted id.
    // AgentChatDrawer.tsx's `send()` uses it as the tail's `?after=` cursor
    // instead of restarting with a null cursor — a null cursor hits the
    // tail's no-cursor branch (`listMessages` capped at the last 50 rows),
    // which wholesale-REPLACES the transcript and silently drops any turn
    // further back than that window. A cursor scoped to right before this
    // turn's own messages MERGES instead (see `handleTailEvent`'s cursored
    // branch) — no history lost, and (since `afterId` is a strict `>`, not
    // `>=`) this exact row is never re-delivered either, so there's no
    // duplicate-bubble risk from the client's own optimistic echo.
    const success = { user_message_id: userMessageId, ...extraOnSuccess };
    if (jobId) {
      res.status(202).json({ queued: true, job_id: jobId, ...success });
      return;
    }

    // Round 2 fix, item 1: `enqueue` returning `null` now has two possible
    // causes now that AGENT_TURN uses the `stately` policy — the queue is
    // genuinely down (the default `enqueue`'s catch branch, `getBoss()`
    // threw), or pg-boss deduped this send because a job for this
    // conversation is already queued/active (not a failure at all — e.g. a
    // retried client request that actually landed the first time).
    const deduped = await hasLiveAgentTurnJob(conversationId);
    if (deduped) {
      res.status(202).json({ queued: true, deduped: true, ...success });
      return;
    }

    // Don't lie about queued:true when enqueue silently failed. The
    // conversation + message are already persisted (and the lock already
    // released above), so a retry picks up right where this left off —
    // nothing left here to release.
    console.error("[agent] job enqueue returned no id — reporting 503", { conversationId, siteId });
    res.status(503).json({ error: "job queue unavailable" });
  }

  // -------------------------------------------------------------------------
  // POST /sites/:siteId/agent/conversations — create a conversation, optionally
  // seeded with a first user message. Creation itself never streams: an
  // inline turn always happens via a follow-up POST .../messages.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/agent/conversations",
    admin,
    messageLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = createConversationPayload.safeParse(req.body);
      if (!parsed.success) {
        invalidPayload(res, parsed.error);
        return;
      }
      const { siteId } = req.params;
      const { title, message, run } = parsed.data;

      try {
        const siteOk = await pool.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        const resolvedTitle = title ?? (message ? message.slice(0, 60) : "New conversation");
        const conversation = await createConversation(pool, siteId, resolvedTitle);

        if (message) {
          if (run === "job") {
            // Item 1 (Codex P1 — serialize turns per conversation), reordered
            // per round 2 item 2: `runJobTurn` claims BEFORE appending the
            // seed message, then releases before enqueueing (see its doc
            // comment above for why the release has to happen before, not
            // after, the `send()` call). The job handler
            // (src/server/jobs/agent-turn.ts) claims 'running' again for
            // itself at entry and HOLDS it for the turn's full (potentially
            // long) execution — that's what actually closes the race this
            // fix targets (a later inline message POST arriving while the
            // job build is still tailing).
            await runJobTurn(res, { conversationId: conversation.id, siteId, message }, { conversation });
            return;
          }
          await appendMessage(pool, conversation.id, "user", [{ type: "text", text: message }]);
        }

        res.status(201).json({ conversation });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /sites/:siteId/agent/conversations — list, most-recently-active first.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/agent/conversations",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const conversations = await listConversations(pool, req.params.siteId);
        res.status(200).json({ conversations });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /sites/:siteId/agent/conversations/:conversationId — full history,
  // ascending. Cross-tenant guard: getConversation is site-scoped, so a
  // conversation under a different siteId 404s exactly like a missing one.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/agent/conversations/:conversationId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, conversationId } = req.params;
      try {
        const conversation = await getConversation(pool, conversationId, siteId);
        if (!conversation) {
          res.status(404).json({ error: "conversation not found" });
          return;
        }
        const messages = await listMessages(pool, conversationId);
        res.status(200).json({ conversation, messages });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /sites/:siteId/agent/conversations/:conversationId/messages
  //
  // Task A2: enqueue-only, always. Append the user message + enqueue an
  // AGENT_TURN job, 202 immediately — no agent turn ever runs inside this
  // (or any) HTTP request (Cloud Run's 60s timeout — global-constraints.md).
  // The client tails progress via `GET .../events` (started right after the
  // 202 — see AgentChatDrawer.tsx). A conversation in status:'error' is
  // allowed through (the new message IS the resume — see docs/ai-agent.md
  // "Resume semantics").
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/agent/conversations/:conversationId/messages",
    admin,
    messageLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = postMessagePayload.safeParse(req.body);
      if (!parsed.success) {
        invalidPayload(res, parsed.error);
        return;
      }
      const { siteId, conversationId } = req.params;
      const { message } = parsed.data;

      try {
        const conversation = await getConversation(pool, conversationId, siteId);
        if (!conversation) {
          res.status(404).json({ error: "conversation not found" });
          return;
        }

        // Item 1 (Codex P1 — serialize turns per conversation): a second
        // message POST while a turn is already running for this
        // conversation would otherwise interleave invalid Anthropic history
        // + conflicting mutations. `runJobTurn` claims the turn lock
        // atomically BEFORE appending the message or doing anything else —
        // a conversation in status:'error' is claimable (matches the
        // existing "resume on error" semantics documented above), and a
        // `running` conversation whose `updated_at` is stale (>10min,
        // appendMessage keeps re-arming it for a genuinely active turn) is
        // claimable too, covering a turn that crashed without releasing.
        // `runJobTurn` does its own claim → append → release → enqueue
        // (round 2 item 2's reordering — see its doc comment above) and
        // writes the response itself; `conversation_id` in the success
        // payload is what the client's tail keys off of.
        await runJobTurn(res, { conversationId, siteId, message }, { conversation_id: conversationId });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /sites/:siteId/agent/conversations/:conversationId/events?after=<id>
  // SSE tail for job-run turns (progress lands in ai_messages; there's no
  // in-request onEvent to stream). Unlike the preview route, this one is
  // fetched by `streamAgentEvents` (AgentChatDrawer.tsx / agent-api.ts)
  // via `fetch()` with an `X-Admin-Token` header, never a native
  // EventSource — so it doesn't need `tokenFromQuery`'s `?token=` shim, and
  // dropping it here means the long-lived admin token never has to appear
  // in a URL (server access logs, browser history, proxy logs) for this
  // route. IMPORTANT 3 follow-up: the page-preview route (admin-pages.ts)
  // still needs `tokenFromQuery` — its consumer IS a plain <iframe
  // src=...>, which can't set headers — but replacing that long-lived admin
  // token with a short-lived, single-use preview token is deferred to a
  // later phase.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/agent/conversations/:conversationId/events",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, conversationId } = req.params;
      const after = typeof req.query.after === "string" ? req.query.after : undefined;

      let conversation;
      let initialMessages;
      try {
        conversation = await getConversation(pool, conversationId, siteId);
        if (!conversation) {
          res.status(404).json({ error: "conversation not found" });
          return;
        }
        initialMessages = after
          ? await listMessages(pool, conversationId, { afterId: after })
          : await listMessages(pool, conversationId, { limit: 50 });
      } catch (err) {
        next(err);
        return;
      }

      sseInit(res);
      // A client that tears down its side of the connection abruptly (e.g. a
      // test harness reading one SSE frame off a raw socket then calling
      // `req.destroy()`, or a browser tab closing mid-stream) leaves this
      // response's `writableEnded` UNSET — the server never called
      // `res.end()` — so `sseSend`'s dead-socket guard below doesn't catch
      // it. The next write attempt (from an already-in-flight poll tick that
      // was mid-DB-query when `close` fired, so `clearInterval` didn't stop
      // it in time) then errors on the broken socket; Node delivers that via
      // the stream's `error` event, not a thrown exception, so the poll
      // tick's own try/catch never sees it. With no listener here, that's an
      // uncaught error at the process level — striking whatever test happens
      // to be running next in this single-fork suite, which is exactly the
      // kind of untraceable cross-test flake this route must never cause.
      res.on("error", () => {
        // Client already gone — nothing to report back to.
      });
      sseSend(res, { type: "snapshot", conversation, messages: initialMessages });

      let lastSeenId: string | null =
        initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].id : (after ?? null);
      let lastStatus = conversation.status;

      // Item 12 (CodeRabbit — tail poll overlap): a `setInterval` tick fires
      // on a fixed clock regardless of whether the PREVIOUS tick's async DB
      // work has finished — under a slow/loaded DB, two overlapping ticks
      // could both read the same "new since lastSeenId" window and each
      // advance `lastSeenId` off their own (possibly differently-ordered)
      // results, or double-send a message. `inFlight` makes a tick that
      // starts while the previous one is still running a no-op instead.
      let inFlight = false;
      const pollTimer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        void (async () => {
          try {
            const newMessages = lastSeenId
              ? await listMessages(pool, conversationId, { afterId: lastSeenId })
              : await listMessages(pool, conversationId, {});
            for (const m of newMessages) {
              sseSend(res, { type: "message", message: m });
              lastSeenId = m.id;
            }
            const fresh = await getConversation(pool, conversationId, siteId);
            if (fresh && fresh.status !== lastStatus) {
              lastStatus = fresh.status;
              sseSend(res, { type: "status", status: fresh.status });
            }
          } catch {
            // Best-effort poll — keep the connection alive; a transient DB
            // hiccup shouldn't kill the tail (the client just sees no update
            // this tick, then heartbeats keep the connection open for retry).
          } finally {
            inFlight = false;
          }
        })();
      }, 1000);

      const heartbeatTimer = setInterval(() => {
        // Minor 8: same dead-socket guard as `sseSend` — without it, a
        // heartbeat tick that lands after the client disconnects (but
        // before this timer is cleared by the `close` handler below) writes
        // to an already-ended response and throws.
        if (res.writableEnded) return;
        res.write(": hb\n\n");
      }, 15_000);

      const stopTimers = () => {
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
      };
      // Both listeners, whichever fires first — `req`'s `close` event isn't
      // reliably emitted for every abrupt client-side teardown (a client
      // that reads one SSE frame off a raw socket then calls
      // `req.destroy()`, e.g. tests/integration/ai-agent-routes.test.ts's
      // `fetchFirstSseEvent`, matches this exactly), whereas `res`'s `close`
      // event fires whenever the underlying connection is gone regardless of
      // which side tore it down. Without this second listener, a request
      // whose `req.close` never fires leaks these two intervals for the
      // lifetime of the whole test process — each one still doing real DB
      // queries every 1s/15s — competing with every other test's Postgres
      // queries and CPU for the rest of the run. `clearInterval` on an
      // already-cleared id is a safe no-op, so both listeners firing is fine.
      req.on("close", stopTimers);
      res.on("close", stopTimers);
    },
  );

  return router;
}
