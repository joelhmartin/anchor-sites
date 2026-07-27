import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { runAgentTurn } from "../ai/agent/loop.js";
import {
  createConversation,
  getConversation,
  listConversations,
  appendMessage,
  listMessages,
  setConversationStatus,
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
 * Two SSE producers:
 *   - `POST .../messages` (run:"inline") streams ONE turn's `AgentTurnEvent`s
 *     live as they're emitted by `runAgentTurn`'s `onEvent` callback.
 *   - `GET .../events` tails a conversation from the DB (for job-run turns,
 *     which have no in-request `onEvent` to stream) — polls `ai_messages`/
 *     `ai_conversations` and re-emits new rows as `AgentTailEvent`s.
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
  run: z.enum(["inline", "job"]).default("inline"),
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
  /** Injectable for tests — the real turn loop is far too slow/expensive to run in an HTTP test. */
  runTurn?: typeof runAgentTurn;
  /** Injectable for tests. Default: lazy `getBoss().send(AGENT_TURN, input)`, swallowing failures to `null`. */
  enqueue?: (input: AgentTurnInput) => Promise<string | null>;
  /** Rate limit for message-sending routes (both cost model spend). Default 10/min. */
  messageRateLimit?: RateLimitOptions;
};

export function adminAiAgentRouter(opts: AdminAiAgentOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();
  const runTurn = opts.runTurn ?? runAgentTurn;
  const enqueue: (input: AgentTurnInput) => Promise<string | null> =
    opts.enqueue ??
    (async (input) => {
      try {
        return await getBoss().send(AGENT_TURN, input);
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
  const messageLimiter = rateLimit(opts.messageRateLimit ?? { max: 10, windowMs: 60_000 });

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
          await appendMessage(pool, conversation.id, "user", [{ type: "text", text: message }]);
          if (run === "job") {
            const jobId = await enqueue({ conversationId: conversation.id, siteId });
            if (!jobId) {
              // Fix round 1: don't lie about queued:true when enqueue
              // silently failed. The conversation + message are already
              // persisted, so a retry (POST .../messages, run:"job") picks
              // up right where this left off.
              console.error("[agent] job enqueue returned no id — reporting 503", {
                conversationId: conversation.id,
                siteId,
              });
              res.status(503).json({ error: "job queue unavailable" });
              return;
            }
            res.status(202).json({ conversation, queued: true, job_id: jobId });
            return;
          }
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
  // run:"job"    → append + enqueue, 202 (job tails via GET .../events).
  // run:"inline" → append, then stream the turn live over SSE. A turn that
  // hits the route's 45s/15-tool-call caps returns reason:"promoted" — the
  // done event already told the client, so this enqueues the continuation
  // job silently and ends the stream. A conversation in status:'error' is
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
      const { message, run } = parsed.data;

      try {
        const conversation = await getConversation(pool, conversationId, siteId);
        if (!conversation) {
          res.status(404).json({ error: "conversation not found" });
          return;
        }

        await appendMessage(pool, conversationId, "user", [{ type: "text", text: message }]);

        if (run === "job") {
          const jobId = await enqueue({ conversationId, siteId });
          if (!jobId) {
            console.error("[agent] job enqueue returned no id — reporting 503", {
              conversationId,
              siteId,
            });
            res.status(503).json({ error: "job queue unavailable" });
            return;
          }
          res.status(202).json({ queued: true, job_id: jobId });
          return;
        }

        // Fix round 1 (reviewer extra #3): if the client disconnects mid-turn,
        // `sseSend` already no-ops on a torn-down `res` (see its comment), but
        // the turn ITSELF must keep running — it's doing real, persisted work
        // (page writes, revisions) that shouldn't die just because a tab
        // closed, and a `promoted` turn's continuation job still needs to be
        // enqueued regardless. `clientGone` only gates the (now-pointless)
        // SSE writes; it never short-circuits `runTurn` or the enqueue below.
        let clientGone = false;
        req.on("close", () => {
          clientGone = true;
        });

        sseInit(res);
        try {
          const result = await runTurn({
            pool,
            conversationId,
            siteId,
            onEvent: (e) => {
              if (!clientGone) sseSend(res, e);
            },
            limits: { maxToolCalls: 15, deadlineMs: 45_000 },
          });
          if (result.reason === "promoted") {
            const jobId = await enqueue({ conversationId, siteId });
            if (!jobId) {
              // Important 5: the client already saw `turn_done`
              // reason:"promoted" (emitted by runTurn's onEvent above) —
              // without this, a failed enqueue here stalls the conversation
              // silently: the drawer thinks a background job is coming to
              // finish the turn, but nothing was ever queued. Tell the
              // client explicitly (a second turn_done frame, reason:"error")
              // and flip the conversation to status:"error" so the existing
              // resume path (a conversation in status:'error' is allowed
              // through on the next message, per the route's header
              // comment) picks it back up on retry.
              console.error("[agent] promoted-turn continuation enqueue returned no id", {
                conversationId,
                siteId,
              });
              await setConversationStatus(pool, conversationId, "error");
              if (!clientGone) {
                sseSend(res, {
                  type: "turn_done",
                  reason: "error",
                  message: "continuation could not be queued — press Resume or send another message",
                });
              }
            }
          }
        } catch {
          await setConversationStatus(pool, conversationId, "error").catch(() => undefined);
          if (!clientGone) sseSend(res, { type: "turn_done", reason: "error", message: "internal" });
        } finally {
          if (!clientGone) res.end();
        }
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
      sseSend(res, { type: "snapshot", conversation, messages: initialMessages });

      let lastSeenId: string | null =
        initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].id : (after ?? null);
      let lastStatus = conversation.status;

      const pollTimer = setInterval(() => {
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

      req.on("close", () => {
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
      });
    },
  );

  return router;
}
