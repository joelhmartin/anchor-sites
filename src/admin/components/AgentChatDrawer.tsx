import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import {
  streamAgentEvents,
  type AgentChangeEvent,
  type AgentTailEvent,
  type AgentTurnEvent,
  type AiConversation,
  type AiMessage,
} from "../lib/agent-api.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export type AgentChatDrawerProps = {
  siteId: string;
  slug: string;
  open: boolean;
  onClose: () => void;
  onSiteChanged: () => void;
  /** Start tailing `/events` on mount (used right after a wizard job-run build). */
  autoTail?: boolean;
  /** Fires for every event (streamed or tailed) that carries a `change`. */
  onChangeEvent?: (c: AgentChangeEvent) => void;
};

type DisplayItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "change"; change: AgentChangeEvent };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Best-effort reconstruction of an `AgentChangeEvent` from a persisted
 * `tool_result` block's parsed `content`. The live SSE `tool_result` event
 * carries the full `change` object (kind + summary); the DB only stores
 * `result.data` (e.g. `{ page_id, revision_id, diff }`), so a card rebuilt
 * from history after a job-run tail can only infer `kind`/`summary`, not
 * read them verbatim. Good enough to render a card and enable Open page /
 * Revert; not a faithful replay of the original event.
 */
function deriveChangeFromToolData(data: unknown): AgentChangeEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.page_id !== "string") return null;
  const page_id = d.page_id;
  const revision_id = typeof d.revision_id === "string" ? d.revision_id : undefined;
  const diff = d.diff as { summary?: string } | undefined;
  if (diff && typeof diff.summary === "string") {
    return { kind: "page_updated", page_id, revision_id, summary: diff.summary };
  }
  if (revision_id) {
    return { kind: "page_created", page_id, revision_id, summary: "Page created" };
  }
  return null;
}

function deriveItemsFromMessage(m: AiMessage): DisplayItem[] {
  const blocks = Array.isArray(m.content) ? (m.content as Record<string, unknown>[]) : [];
  if (m.role === "user" || m.role === "assistant") {
    const kind = m.role;
    return blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b?.type === "text" && typeof b.text === "string")
      .map(({ b, i }) => ({ id: `${m.id}-${i}`, kind, text: b.text as string }));
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

function ChangeCard({
  siteId,
  slug,
  change,
  onSiteChanged,
}: {
  siteId: string;
  slug: string;
  change: AgentChangeEvent;
  onSiteChanged: () => void;
}) {
  const [reverting, setReverting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function revert() {
    if (!change.page_id || !change.revision_id) return;
    setReverting(true);
    setErr(null);
    try {
      await apiFetch(
        `/api/sites/${siteId}/pages/${change.page_id}/revisions/${change.revision_id}/restore`,
        { method: "POST" },
      );
      onSiteChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Revert failed.");
    } finally {
      setReverting(false);
    }
  }

  return (
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardContent className="flex flex-col gap-2 p-3 pt-3 text-sm">
        <p className="text-zinc-700">{change.summary}</p>
        <div className="flex items-center gap-3">
          {change.page_id && (
            <Link
              to={`/sites/${slug}/pages/${change.page_id}`}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Open page
            </Link>
          )}
          {change.revision_id && (
            <Button type="button" variant="outline" size="sm" onClick={revert} disabled={reverting}>
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          )}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Studio chat drawer (P-T11 / design doc §Studio chat). Talks to Task 10's
 * agent HTTP API: lists/creates the site's conversation, streams an inline
 * turn's SSE events into the transcript, and — when a turn is `promoted` to
 * a background job — switches to tailing `/events` so the transcript keeps
 * filling in from persisted messages. Every `change` (live or tailed) pings
 * `onSiteChanged` (and `onChangeEvent`, for Task 12's preview iframe) so the
 * caller can refresh whatever it's showing.
 */
export function AgentChatDrawer({
  siteId,
  slug,
  open,
  onClose,
  onSiteChanged,
  autoTail,
  onChangeEvent,
}: AgentChatDrawerProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idCounter = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const tailAbortRef = useRef<AbortController | null>(null);

  function nextId(): string {
    idCounter.current += 1;
    return `local-${idCounter.current}`;
  }

  function noteChange(change: AgentChangeEvent) {
    onSiteChanged();
    onChangeEvent?.(change);
  }

  function startTail(id: string, afterId: string | null) {
    tailAbortRef.current?.abort();
    const controller = new AbortController();
    tailAbortRef.current = controller;
    const qs = afterId ? `?after=${afterId}` : "";
    streamAgentEvents(`/api/sites/${siteId}/agent/conversations/${id}/events${qs}`, {
      signal: controller.signal,
      onEvent: (e) => handleTailEvent(e as AgentTailEvent),
    }).catch(() => {
      // aborted (drawer closed / unmounted) or connection dropped — best-effort tail
    });
  }

  function handleTailEvent(e: AgentTailEvent) {
    if (e.type === "snapshot") {
      setConversation(e.conversation);
      const derived = e.messages.flatMap(deriveItemsFromMessage);
      setItems((prev) => [...prev, ...derived]);
      const last = e.messages[e.messages.length - 1];
      if (last) lastMessageIdRef.current = last.id;
      for (const item of derived) if (item.kind === "change") noteChange(item.change);
    } else if (e.type === "message") {
      const derived = deriveItemsFromMessage(e.message);
      setItems((prev) => [...prev, ...derived]);
      lastMessageIdRef.current = e.message.id;
      for (const item of derived) if (item.kind === "change") noteChange(item.change);
    } else if (e.type === "status") {
      setConversation((prev) => (prev ? { ...prev, status: e.status } : prev));
    }
  }

  function handleTurnEvent(e: AgentTurnEvent, cid: string) {
    if (e.type === "assistant_text") {
      setItems((prev) => [...prev, { id: nextId(), kind: "assistant", text: e.text }]);
    } else if (e.type === "tool_result") {
      if (e.change) {
        const change = e.change;
        setItems((prev) => [...prev, { id: nextId(), kind: "change", change }]);
        noteChange(change);
      }
    } else if (e.type === "turn_done") {
      if (e.reason === "promoted") {
        startTail(cid, lastMessageIdRef.current);
      } else if (e.reason === "error") {
        setConversation((prev) => (prev ? { ...prev, status: "error" } : prev));
      }
    }
  }

  // Load (or note) the site's conversation on open; optionally start
  // tailing it immediately (autoTail — the wizard's job-run build path).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ conversations: AiConversation[] }>(
          `/api/sites/${siteId}/agent/conversations`,
        );
        if (cancelled) return;
        const existing = res.conversations.find((c) => c.status === "active" || c.status === "error");
        if (existing) {
          setConversationId(existing.id);
          setConversation(existing);
          if (autoTail) startTail(existing.id, null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load the conversation.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);

  // Abort any in-flight tail when the drawer closes or unmounts.
  useEffect(() => {
    if (!open) tailAbortRef.current?.abort();
    return () => tailAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    setItems((prev) => [...prev, { id: nextId(), kind: "user", text }]);
    try {
      let cid = conversationId;
      if (!cid) {
        const created = await apiFetch<{ conversation: AiConversation }>(
          `/api/sites/${siteId}/agent/conversations`,
          { method: "POST" },
        );
        cid = created.conversation.id;
        setConversationId(cid);
        setConversation(created.conversation);
      }
      await streamAgentEvents(`/api/sites/${siteId}/agent/conversations/${cid}/messages`, {
        body: { message: text },
        onEvent: (e) => handleTurnEvent(e as AgentTurnEvent, cid as string),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Message failed to send.");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const usage = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };

  return (
    <div
      aria-label="Studio chat"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Studio chat</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          Close
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {items.map((item) => {
          if (item.kind === "user") {
            return (
              <div
                key={item.id}
                className="ml-auto max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                {item.text}
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              <div
                key={item.id}
                className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800"
              >
                {item.text}
              </div>
            );
          }
          return (
            <ChangeCard key={item.id} siteId={siteId} slug={slug} change={item.change} onSiteChanged={onSiteChanged} />
          );
        })}
      </div>

      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

      <div className="border-t border-zinc-200 p-4">
        {conversation?.status === "error" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mb-2"
            onClick={() => send("continue")}
            disabled={sending}
          >
            Resume
          </Button>
        )}
        <textarea
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Tell the agent what to build or change…"
          className="w-full rounded border border-zinc-300 p-2 text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          <Button type="button" onClick={() => send()} disabled={sending || !draft.trim()}>
            {sending ? "Sending…" : "Send"}
          </Button>
          <span className="text-xs text-zinc-400">{usage.input + usage.output} tokens today</span>
        </div>
      </div>
    </div>
  );
}
