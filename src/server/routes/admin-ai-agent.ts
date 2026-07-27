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

export function sseSend(res: Response, data: unknown): void {
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
      } catch {
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
            await enqueue({ conversationId: conversation.id, siteId });
            res.status(202).json({ conversation, queued: true });
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
          await enqueue({ conversationId, siteId });
          res.status(202).json({ queued: true });
          return;
        }

        sseInit(res);
        try {
          const result = await runTurn({
            pool,
            conversationId,
            siteId,
            onEvent: (e) => sseSend(res, e),
            limits: { maxToolCalls: 15, deadlineMs: 45_000 },
          });
          if (result.reason === "promoted") {
            await enqueue({ conversationId, siteId });
          }
        } catch {
          sseSend(res, { type: "turn_done", reason: "error", message: "internal" });
        } finally {
          res.end();
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /sites/:siteId/agent/conversations/:conversationId/events?after=<id>
  // SSE tail for job-run turns (progress lands in ai_messages; there's no
  // in-request onEvent to stream). `tokenFromQuery` first so a native
  // EventSource (which can't set custom headers) can authenticate via
  // `?token=`.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/agent/conversations/:conversationId/events",
    tokenFromQuery,
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
