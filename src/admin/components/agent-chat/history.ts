// src/admin/components/agent-chat/history.ts
//
// Reconstructs `DisplayItem`s from persisted `AiMessage`s (history hydration
// / tail replay). Unchanged logic from the original AgentChatDrawer.tsx,
// just relocated so the drawer file stays a manageable size.

import type { AgentChangeEvent, AiMessage } from "../../lib/agent-api.js";
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
  if (m.role === "user" || m.role === "assistant") {
    const kind = m.role;
    return blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b?.type === "text" && typeof b.text === "string")
      .map(({ b, i }) => ({ id: `${m.id}-${i}`, kind, text: b.text as string }) as DisplayItem);
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
