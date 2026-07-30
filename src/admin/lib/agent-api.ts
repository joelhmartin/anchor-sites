import { ApiError } from "./apiFetch.js";
import { getAdminToken, clearAdminToken } from "./adminToken.js";

/**
 * Studio chat drawer types (P-T11). These mirror the shapes documented by
 * Task 10's HTTP API (`src/server/routes/admin-ai-agent.ts`) and Task 8's
 * agent loop (`src/server/ai/agent/loop.ts`), but are declared locally —
 * the admin bundle must never import server modules.
 */
export type AgentChangeEvent = {
  kind:
    | "page_created"
    | "page_updated"
    | "page_deleted"
    | "site_updated"
    | "template_applied"
    | "image_imported";
  page_id?: string;
  revision_id?: string;
  summary: string;
};

/**
 * Task A2 (2026-07-30 lovable-workspace SDD) deleted the inline turn's HTTP
 * path — no agent turn ever runs inside a request anymore, so the client
 * never receives a live `AgentTurnEvent` stream. `TurnDoneReason`/
 * `AgentTurnEvent` stay exported: `chatReducer.ts`'s pure turn-state
 * reducer (and its own tests) still reference the shape, even though
 * nothing in this file constructs these events over the wire any longer —
 * every turn's progress now arrives as persisted `AgentTailEvent`s (below)
 * via the `GET .../events` tail, which is all `streamAgentEvents` streams
 * these days.
 */
export type TurnDoneReason = "end_turn" | "max_tools" | "budget" | "error" | "promoted";

export type AgentTurnEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary?: string; change?: AgentChangeEvent }
  | { type: "turn_done"; reason: TurnDoneReason; message?: string };

export type AiConversation = {
  id: string;
  site_id: string;
  title: string;
  status: "active" | "error" | "archived" | "running";
  token_usage: Record<string, { input: number; output: number }>;
  created_at?: string;
  updated_at?: string;
};

export type AiMessageRole = "user" | "assistant" | "tool";
export type AiMessage = {
  id: string;
  conversation_id: string;
  role: AiMessageRole;
  content: unknown;
  created_at: string;
};

/** SSE tail events from `GET .../conversations/:id/events?after=<id>`. */
export type AgentTailEvent =
  | { type: "snapshot"; conversation: AiConversation; messages: AiMessage[] }
  | { type: "message"; message: AiMessage }
  | { type: "status"; status: AiConversation["status"] };

/**
 * Streams server-sent events from the job-run tail GET (`.../events`) into
 * `opts.onEvent`. Frames look like `data: {...json...}\n\n`, heartbeats look
 * like `: hb\n\n` and are skipped. Resolves when the stream ends (tail
 * close, or abort).
 *
 * Task A2 (2026-07-30 lovable-workspace SDD) deleted this function's other
 * caller — the inline turn POST, which used to pass `opts.body` to stream
 * ONE turn's `AgentTurnEvent`s live. Every chat turn now enqueues a
 * background job and the client only ever tails via `GET`, so this is
 * GET-only: no `body`, no method branch.
 */
export async function streamAgentEvents(
  path: string,
  opts: { signal?: AbortSignal; onEvent: (e: Record<string, unknown>) => void },
): Promise<void> {
  const token = getAdminToken();
  const res = await fetch(path, {
    method: "GET",
    credentials: "include",
    headers: {
      ...(token ? { "X-Admin-Token": token } : {}),
    },
    signal: opts.signal,
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error body — leave as null
    }
    // Item 7 (CodeRabbit — mirrors apiFetch.ts:47-50): clear the stored
    // token on 401 here too, so an expired/revoked admin token bounces the
    // Studio drawer's guard to /login the same way a plain apiFetch call
    // already does — this SSE path was the one caller that didn't.
    if (res.status === 401) clearAdminToken();
    throw new ApiError(`agent stream request failed (${res.status})`, res.status, body);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line || line.startsWith(":")) continue; // heartbeat
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      try {
        opts.onEvent(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        // malformed frame — skip rather than kill the whole stream
      }
    }
  }
}
