// src/admin/components/agent-chat/history.ts
//
// Reconstructs `DisplayItem`s from persisted `AiMessage`s (history hydration
// / tail replay).
//
// Fix round 1 (Finding 2 — reviewer, Task A2): a background job's ONLY
// mid-turn feedback is what lands in `ai_messages` as the tail polls it —
// there's no in-request event stream anymore. `deriveItemsFromMessage` now
// also turns an assistant message's `tool_use` blocks into visible "step"
// rows (state:"running") for EVERY tool, not just the page-mutating ones
// that already got a `change` card. `deriveToolResultUpdates` reads the
// matching `tool_result` message's `tool_use_id`s and reports how to flip
// each step to `"done"`/`"error"` once it resolves — a separate function
// because updating an ALREADY-RENDERED item is the caller's job (`setItems`
// mapping over the existing array), not something a per-message "these are
// the new items" deriver can express on its own.

import type { AgentChangeEvent, AiMessage } from "../../lib/agent-api.js";
import { friendlyToolLabel } from "./chatReducer.js";
import type { DisplayItem } from "./types.js";

/**
 * Best-effort reconstruction of an `AgentChangeEvent` from a persisted
 * `tool_result` block's parsed `content`. The live SSE `tool_result` event
 * carries the full `change` object (kind + summary); the DB only stores
 * `result.data` (e.g. `{ page_id, revision_id, diff }`), so a card rebuilt
 * from history after a job-run tail can only infer `kind`/`summary`, not
 * read them verbatim. Good enough to render a card and enable Open page /
 * Revert; not a faithful replay of the original event.
 */
export function deriveChangeFromToolData(data: unknown): AgentChangeEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.page_id !== "string") return null;
  const page_id = d.page_id;
  const revision_id = typeof d.revision_id === "string" ? d.revision_id : undefined;
  const diff = d.diff as { summary?: string } | undefined;
  if (diff && typeof diff.summary === "string") {
    // update_page's `data.revision_id` is now the PRIOR (pre-change)
    // revision (Critical 1 fix, tools/pages.ts) — restoring it is a genuine
    // undo of this change, so it's safe to carry through here.
    return { kind: "page_updated", page_id, revision_id, summary: diff.summary };
  }
  if (revision_id) {
    // create_page's `data.revision_id` is the newly-created page's OWN
    // initial revision, not a prior state — its true inverse is delete, not
    // restore (Critical 1). Deliberately drop `revision_id` here too so a
    // card rebuilt from history doesn't offer a Revert that would just
    // restore the page onto itself.
    return { kind: "page_created", page_id, summary: "Page created" };
  }
  return null;
}

export function deriveItemsFromMessage(m: AiMessage): DisplayItem[] {
  const blocks = Array.isArray(m.content) ? (m.content as Record<string, unknown>[]) : [];
  // W1.4 / D601+D303: a persisted role-'system' row (stall reconciler notes,
  // Stop confirmations, continuation-failure notes) renders as the same
  // amber SystemLine the client already uses for its local system items —
  // so an interrupted/stopped build explains itself even after a reload.
  if (m.role === "system") {
    const items: DisplayItem[] = [];
    blocks.forEach((b, i) => {
      if (b?.type === "text" && typeof b.text === "string") {
        items.push({ id: `${m.id}-${i}`, kind: "system", text: b.text });
      }
    });
    return items;
  }
  if (m.role === "user" || m.role === "assistant") {
    const kind = m.role;
    const items: DisplayItem[] = [];
    blocks.forEach((b, i) => {
      if (b?.type === "text" && typeof b.text === "string") {
        items.push({ id: `${m.id}-${i}`, kind, text: b.text } as DisplayItem);
        return;
      }
      // Assistant-only: a `tool_use` block is the model asking to run a
      // tool — the loop persists it verbatim inside the assistant message
      // (src/server/ai/agent/loop.ts), matched later by its own `id` when
      // the tool_result message lands (see `deriveToolResultUpdates`).
      if (
        kind === "assistant" &&
        b?.type === "tool_use" &&
        typeof b.id === "string" &&
        typeof b.name === "string"
      ) {
        items.push({
          id: `${m.id}-${i}`,
          kind: "step",
          toolCallId: b.id,
          name: b.name,
          label: friendlyToolLabel(b.name),
          state: "running",
        });
      }
    });
    return items;
  }
  if (m.role === "tool") {
    const items: DisplayItem[] = [];
    blocks.forEach((b, i) => {
      if (b?.type !== "tool_result" || typeof b.content !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(b.content);
      } catch {
        return; // only render cards where the matching tool result parses
      }
      const change = deriveChangeFromToolData(parsed);
      if (change) items.push({ id: `${m.id}-${i}`, kind: "change", change });
    });
    return items;
  }
  return [];
}

/**
 * For a `role:"tool"` message, the `{toolCallId, state}` updates its
 * `tool_result` blocks apply to already-rendered `"step"` items — matched
 * by `toolCallId` (the ORIGINAL `tool_use` block's own `id`, which
 * `tool_result.tool_use_id` refers back to). Callers apply these against
 * their existing item list (`items.map(...)`); this function only reads
 * one message, it never mutates anything itself.
 */
export function deriveToolResultUpdates(m: AiMessage): { toolCallId: string; state: "done" | "error" }[] {
  if (m.role !== "tool") return [];
  const blocks = Array.isArray(m.content) ? (m.content as Record<string, unknown>[]) : [];
  const updates: { toolCallId: string; state: "done" | "error" }[] = [];
  for (const b of blocks) {
    if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
      updates.push({ toolCallId: b.tool_use_id, state: b.is_error === true ? "error" : "done" });
    }
  }
  return updates;
}

/**
 * Batch form of `deriveItemsFromMessage` + `deriveToolResultUpdates`, for
 * hydrating/replacing the WHOLE transcript from one ordered message array
 * at once (`hydrateFromMessages`) — a tool_use step and its resolving
 * tool_result can both be within the same batch, so this resolves that
 * correlation in one pass rather than leaving every historical step stuck
 * at `state:"running"`.
 */
export function deriveItemsFromMessages(messages: AiMessage[]): DisplayItem[] {
  const items = messages.flatMap(deriveItemsFromMessage);
  for (const m of messages) {
    for (const update of deriveToolResultUpdates(m)) {
      const idx = items.findIndex((it) => it.kind === "step" && it.toolCallId === update.toolCallId);
      if (idx !== -1) {
        items[idx] = { ...(items[idx] as Extract<DisplayItem, { kind: "step" }>), state: update.state };
      }
    }
  }
  return items;
}
