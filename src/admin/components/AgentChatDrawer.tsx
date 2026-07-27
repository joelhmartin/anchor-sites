import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import {
  streamAgentEvents,
  type AgentChangeEvent,
  type AgentTailEvent,
  type AgentTurnEvent,
  type AiConversation,
  type AiMessage,
} from "../lib/agent-api.js";
import {
  applyTurnEvent,
  finalizeTurn,
  initialTurnState,
  turnDoneMessage,
  type TurnState,
} from "./agent-chat/chatReducer.js";
import { deriveItemsFromMessage } from "./agent-chat/history.js";
import type { DisplayItem } from "./agent-chat/types.js";
import { ChatTranscript } from "./agent-chat/ChatTranscript.js";
import { Composer } from "./agent-chat/Composer.js";
import { EmptyState } from "./agent-chat/EmptyState.js";
import { Button } from "../ui/button.js";

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Studio chat drawer (P-T11 / design doc §Studio chat; upgraded per the
 * comparative-review worklist against anchor-operations' copilot). Talks to
 * Task 10's agent HTTP API: lists/creates the site's conversation, streams
 * an inline turn's SSE events into the transcript, and — when a turn is
 * `promoted` to a background job — switches to tailing `/events` so the
 * transcript keeps filling in from persisted messages. Every `change` (live
 * or tailed) pings `onSiteChanged` (and `onChangeEvent`, for the preview
 * iframe) so the caller can refresh whatever it's showing.
 *
 * While a turn streams, tool_call/tool_result events accumulate into a
 * transient `liveTurn` (see `agent-chat/chatReducer.ts`) rendered as
 * spinner→check step rows + a typing pulse; on `turn_done` that folds into
 * ONE finalized assistant bubble with a collapsed "Worked through N steps"
 * disclosure. Change cards (from `tool_result.change`) still render
 * immediately as their own items, unaffected by that folding.
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
  const [liveTurn, setLiveTurn] = useState<TurnState | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTurnDelta, setLastTurnDelta] = useState<{ input: number; output: number } | null>(null);

  const idCounter = useRef(0);
  // Id of the newest PERSISTED message we've already displayed (from a
  // history hydration or a tailed `message` event) — used both as the
  // `after=` cursor for starting a tail and, via `seenMessageIdsRef`, to
  // dedupe messages a tail might re-deliver.
  const lastMessageIdRef = useRef<string | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const tailAbortRef = useRef<AbortController | null>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const liveTurnRef = useRef<TurnState | null>(null);
  const lastTurnReasonRef = useRef<string | null>(null);

  // Autoscroll pin: only auto-scroll-to-bottom on new content when the user
  // was already near the bottom — don't yank someone reading history
  // (worklist item 2).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  function nextId(): string {
    idCounter.current += 1;
    return `local-${idCounter.current}`;
  }

  function noteChange(change: AgentChangeEvent) {
    onSiteChanged();
    onChangeEvent?.(change);
  }

  function setLiveTurnState(t: TurnState | null) {
    liveTurnRef.current = t;
    setLiveTurn(t);
  }

  function handleTranscriptScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items, liveTurn]);

  /**
   * Replace the transcript with the authoritative persisted history. Used
   * for (a) hydrating an existing conversation's history on open/reopen,
   * and (b) a tail's initial `snapshot` — which, on a mid-turn promotion,
   * necessarily re-includes everything already shown live via
   * `handleTurnEvent` (the client has no message ids to scope `after=` to
   * until it has hydrated at least once). Replacing rather than appending
   * means that replay can never render alongside the transient local items
   * it supersedes, so no duplicate bubbles/cards. Does NOT fire
   * `onSiteChanged`/`onChangeEvent` — those already fired live for
   * anything genuinely new; a replay of history a user is (re)opening to
   * read shouldn't re-trigger site-changed side effects.
   */
  function hydrateFromMessages(messages: AiMessage[]) {
    setItems(messages.flatMap(deriveItemsFromMessage));
    seenMessageIdsRef.current = new Set(messages.map((m) => m.id));
    const last = messages[messages.length - 1];
    if (last) lastMessageIdRef.current = last.id;
  }

  /** Append one newly-tailed persisted message, deduped by id. */
  function appendPersistedMessage(message: AiMessage) {
    if (seenMessageIdsRef.current.has(message.id)) return;
    seenMessageIdsRef.current.add(message.id);
    lastMessageIdRef.current = message.id;
    const derived = deriveItemsFromMessage(message);
    if (derived.length === 0) return;
    setItems((prev) => [...prev, ...derived]);
    for (const item of derived) if (item.kind === "change") noteChange(item.change);
  }

  function startTail(id: string, afterId: string | null) {
    tailAbortRef.current?.abort();
    const controller = new AbortController();
    tailAbortRef.current = controller;
    const qs = afterId ? `?after=${afterId}` : "";
    streamAgentEvents(`/api/sites/${siteId}/agent/conversations/${id}/events${qs}`, {
      signal: controller.signal,
      // `afterId` is captured per-call: the server's `snapshot` payload
      // shape depends on whether `after=` was sent (Task 10's tail route —
      // `after` given → only messages newer than it; else the last 50), so
      // the handler needs to know which one it's looking at.
      onEvent: (e) => handleTailEvent(e as AgentTailEvent, afterId),
    }).catch(() => {
      // aborted (drawer closed / unmounted) or connection dropped — best-effort tail
    });
  }

  function handleTailEvent(e: AgentTailEvent, cursor: string | null) {
    if (e.type === "snapshot") {
      setConversation(e.conversation);
      if (cursor === null) {
        // No cursor was sent → the server's snapshot is the full recent
        // history (last 50), which may re-include everything already
        // rendered live this turn (e.g. a mid-turn promotion on a
        // never-hydrated conversation) — replace wholesale rather than
        // dedup-merge (see `hydrateFromMessages`).
        hydrateFromMessages(e.messages);
      } else {
        // A cursor was sent → the server already scoped the snapshot to
        // messages newer than it. Merging (id-deduped, appended) instead
        // of replacing avoids wiping transcript already hydrated before
        // this tail started (e.g. reopening an existing conversation with
        // `autoTail` — history was hydrated from the conversation-detail
        // fetch, then the tail's own snapshot must ADD to it, not erase it).
        for (const m of e.messages) appendPersistedMessage(m);
      }
    } else if (e.type === "message") {
      appendPersistedMessage(e.message);
    } else if (e.type === "status") {
      setConversation((prev) => (prev ? { ...prev, status: e.status } : prev));
    }
  }

  /** Live tool_call/assistant_text/tool_result deltas fold into the transient `liveTurn`. */
  function applyLiveEvent(e: AgentTurnEvent) {
    setLiveTurnState(applyTurnEvent(liveTurnRef.current ?? initialTurnState(), e));
  }

  function handleTurnEvent(e: AgentTurnEvent, cid: string) {
    if (e.type === "turn_done") {
      lastTurnReasonRef.current = e.reason;
      const finalState = liveTurnRef.current ?? initialTurnState();
      const final = finalizeTurn(finalState);
      setLiveTurnState(null);

      const newItems: DisplayItem[] = [];
      // Only promote a real answer/trace — a promoted turn with no text yet
      // and no tools run would just add an empty bubble.
      if (final.text || final.stepCount > 0) {
        newItems.push({
          id: nextId(),
          kind: "assistant",
          text: final.text,
          reasoning:
            final.stepCount > 0
              ? { stepCount: final.stepCount, seconds: final.seconds, toolSteps: final.toolSteps }
              : undefined,
        });
      }
      const sysText = turnDoneMessage(e.reason, e.message);
      if (sysText) newItems.push({ id: nextId(), kind: "system", text: sysText });
      if (newItems.length > 0) setItems((prev) => [...prev, ...newItems]);

      if (e.reason === "error") {
        setConversation((prev) => (prev ? { ...prev, status: "error" } : prev));
      } else if (e.reason === "promoted") {
        // ALWAYS restart the tail with a null cursor here, even if
        // `lastMessageIdRef` already holds a (now-stale, pre-this-turn)
        // value from an earlier hydration. A non-null cursor would hit the
        // cursored MERGE path in `handleTailEvent`, and the cursored
        // snapshot would contain THIS turn's own persisted messages —
        // which are already on screen as transient live items (carrying
        // local- ids, so `seenMessageIdsRef` can't recognize them as
        // duplicates) — rendering everything twice. A null cursor instead
        // takes the full-REPLACE path (`hydrateFromMessages`), which
        // discards those transient live items and rebuilds the transcript
        // from the persisted, authoritative last-50 — no duplicates
        // possible regardless of prior hydration state.
        startTail(cid, null);
      }
      return;
    }

    if (e.type === "tool_result" && e.change) {
      const change = e.change;
      setItems((prev) => [...prev, { id: nextId(), kind: "change", change }]);
      noteChange(change);
    }
    applyLiveEvent(e);
  }

  // Load (or note) the site's conversation on open. If one already exists,
  // hydrate the transcript from its persisted history (GET .../:id →
  // { conversation, messages }) BEFORE wiring up any live sends, so
  // reopening the drawer doesn't show a blank transcript. autoTail then
  // additionally starts a live tail from that hydrated point on.
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
          try {
            const detail = await apiFetch<{ conversation: AiConversation; messages: AiMessage[] }>(
              `/api/sites/${siteId}/agent/conversations/${existing.id}`,
            );
            if (cancelled) return;
            setConversation(detail.conversation);
            hydrateFromMessages(detail.messages);
          } catch {
            // history hydration is best-effort — the drawer still works for new sends
          }
          if (autoTail) startTail(existing.id, lastMessageIdRef.current);
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

  // Abort any in-flight tail AND any in-flight turn when the drawer closes
  // or unmounts (worklist item 4).
  useEffect(() => {
    if (!open) {
      tailAbortRef.current?.abort();
      sendAbortRef.current?.abort();
    }
    return () => {
      tailAbortRef.current?.abort();
      sendAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || sending) return;
    // Stop any running tail (e.g. idle autoTail on a reopened conversation)
    // so live turn events are the only update source while this inline
    // turn is in flight — otherwise a tailed `message` could interleave
    // with (or race) what the turn itself is about to render. A promoted
    // turn or a later job run restarts tailing as needed.
    tailAbortRef.current?.abort();
    setSending(true);
    setError(null);
    setDraft("");
    setItems((prev) => [...prev, { id: nextId(), kind: "user", text }]);
    setLiveTurnState(initialTurnState());
    lastTurnReasonRef.current = null;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    const usageBefore = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
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
        signal: controller.signal,
        onEvent: (e) => handleTurnEvent(e as AgentTurnEvent, cid as string),
      });

      // Best-effort per-turn token-usage delta (worklist item 10). Skipped
      // for a promoted turn — the tail's own `snapshot` already refreshes
      // `conversation` (see `handleTailEvent`), and racing a second fetch
      // here could clobber that with stale data.
      if (cid && lastTurnReasonRef.current && lastTurnReasonRef.current !== "promoted") {
        try {
          const detail = await apiFetch<{ conversation: AiConversation }>(
            `/api/sites/${siteId}/agent/conversations/${cid}`,
          );
          setConversation(detail.conversation);
          const usageAfter = detail.conversation.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
          const delta = { input: usageAfter.input - usageBefore.input, output: usageAfter.output - usageBefore.output };
          if (delta.input + delta.output > 0) setLastTurnDelta(delta);
        } catch {
          // best-effort — the footer just won't show a delta this turn
        }
      }
    } catch (err) {
      const aborted = (err as { name?: string } | null)?.name === "AbortError";
      if (aborted) {
        setItems((prev) => [...prev, { id: nextId(), kind: "system", text: "Stopped." }]);
      } else {
        setError(err instanceof ApiError ? err.message : "Message failed to send.");
      }
    } finally {
      setSending(false);
      setLiveTurnState(null);
      sendAbortRef.current = null;
    }
  }

  function stop() {
    sendAbortRef.current?.abort();
  }

  if (!open) return null;

  const usage = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
  const totalToday = usage.input + usage.output;
  const deltaTotal = lastTurnDelta ? lastTurnDelta.input + lastTurnDelta.output : null;
  const usageText = deltaTotal ? `${totalToday} tokens today · +${deltaTotal} this turn` : `${totalToday} tokens today`;
  const showEmptyState = items.length === 0 && !liveTurn;

  return (
    <div
      aria-label="Studio chat"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl max-md:inset-0 max-md:h-[100dvh] max-md:max-w-none max-md:border-l-0"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Studio chat</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          Close
        </Button>
      </div>

      {showEmptyState && <EmptyState onPreset={(preset) => send(preset)} />}

      <ChatTranscript
        items={items}
        liveTurn={liveTurn}
        siteId={siteId}
        slug={slug}
        onSiteChanged={onSiteChanged}
        scrollRef={scrollContainerRef}
        onScroll={handleTranscriptScroll}
      />

      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => send()}
        onStop={stop}
        sending={sending}
        resumeVisible={conversation?.status === "error"}
        onResume={() => send("continue")}
        usageText={usageText}
      />
    </div>
  );
}
