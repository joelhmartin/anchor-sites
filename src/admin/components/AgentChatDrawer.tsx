import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import {
  streamAgentEvents,
  type AgentChangeEvent,
  type AgentTailEvent,
  type AiConversation,
  type AiMessage,
} from "../lib/agent-api.js";
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
  /**
   * Fires whenever the conversation's status or in-flight state changes
   * (Task 11 — the site-detail preview uses this to gate inline editing
   * while the agent is actively working). `busy` is
   * `sending || status === "running"`.
   */
  onStatusChange?: (status: AiConversation["status"] | null, busy: boolean) => void;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Studio chat drawer (P-T11 / design doc §Studio chat; upgraded per the
 * comparative-review worklist against anchor-operations' copilot). Talks to
 * Task 10's agent HTTP API: lists/creates the site's conversation, then
 * (Task A2, 2026-07-30 lovable-workspace SDD) POSTs a message to enqueue a
 * background AGENT_TURN job and immediately starts/refreshes the `/events`
 * tail so the transcript fills in from persisted messages as the job runs.
 * Every `change` (from a tailed `tool_result`) pings `onSiteChanged` (and
 * `onChangeEvent`, for the preview iframe) so the caller can refresh
 * whatever it's showing.
 *
 * No agent turn ever runs inside an HTTP request anymore (Cloud Run's 60s
 * timeout — global-constraints.md), so there's no more in-request
 * `AgentTurnEvent` stream to accumulate into a live, still-typing bubble —
 * assistant replies and tool-result change cards simply appear as the tail
 * delivers the persisted messages behind them. `busy` (derived from
 * `sending` and `conversation.status === "running"`) is what the composer
 * and `onStatusChange` use to know a turn is in flight.
 */
export function AgentChatDrawer({
  siteId,
  slug,
  open,
  onClose,
  onSiteChanged,
  autoTail,
  onChangeEvent,
  onStatusChange,
}: AgentChatDrawerProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
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
  // Task A2: a `send()` marks this true right before starting its tail, and
  // clears it the first time that tail reports a settled (non-"running")
  // status — that's the signal to fetch the per-turn token-usage delta
  // (only for a turn THIS drawer instance kicked off, not e.g. an unrelated
  // autoTail observing someone else's job).
  const pendingUsageRefreshRef = useRef(false);
  const usageBeforeRef = useRef<{ input: number; output: number }>({ input: 0, output: 0 });

  // Autoscroll pin: only auto-scroll-to-bottom on new content when the user
  // was already near the bottom — don't yank someone reading history
  // (worklist item 2).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  // Dialog semantics (bot-review fix wave, item B): the drawer is a modal
  // overlay but was a bare div with no role/keyboard/focus handling. Minimal
  // fix, no Radix rework — role="dialog"/aria-modal below, plus this effect:
  // Escape closes it, the composer textarea gets focus on open, and focus
  // returns to whatever had it before the drawer opened once it closes.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message"]',
    );
    textarea?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  function nextId(): string {
    idCounter.current += 1;
    return `local-${idCounter.current}`;
  }

  function noteChange(change: AgentChangeEvent) {
    onSiteChanged();
    onChangeEvent?.(change);
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
  }, [items]);

  // Task 11 agent-busy guard: report status/busy on every change to
  // `conversation` or `sending` so a caller (site-detail's inline editor)
  // can gate itself while a turn is actively running. `onStatusChange` is
  // intentionally left out of the dep array — it's typically a fresh
  // closure each render, and re-invoking on identity change alone (with
  // unchanged status/busy) would just be redundant work.
  useEffect(() => {
    const status = conversation?.status ?? null;
    const busy = sending || status === "running";
    onStatusChange?.(status, busy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.status, sending]);

  /**
   * Replace the transcript with the authoritative persisted history. Used
   * for (a) hydrating an existing conversation's history on open/reopen,
   * and (b) a tail's initial `snapshot` on a never-hydrated conversation
   * (the client has no message ids to scope `after=` to until it has
   * hydrated at least once). Does NOT fire `onSiteChanged`/`onChangeEvent`
   * — a replay of history a user is (re)opening to read shouldn't
   * re-trigger site-changed side effects.
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
      onEvent: (e) => handleTailEvent(e as AgentTailEvent, afterId, id),
    }).catch(() => {
      // aborted (drawer closed / unmounted) or connection dropped — best-effort tail
    });
  }

  /** Best-effort per-turn token-usage delta (worklist item 10) for a turn THIS
   * drawer instance kicked off — see `pendingUsageRefreshRef`'s doc comment. */
  async function maybeRefreshUsageDelta(id: string) {
    try {
      const detail = await apiFetch<{ conversation: AiConversation }>(
        `/api/sites/${siteId}/agent/conversations/${id}`,
      );
      setConversation(detail.conversation);
      const usageAfter = detail.conversation.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
      const before = usageBeforeRef.current;
      const delta = { input: usageAfter.input - before.input, output: usageAfter.output - before.output };
      if (delta.input + delta.output > 0) setLastTurnDelta(delta);
    } catch {
      // best-effort — the footer just won't show a delta this turn
    }
  }

  function handleTailEvent(e: AgentTailEvent, cursor: string | null, id: string) {
    if (e.type === "snapshot") {
      setConversation(e.conversation);
      if (cursor === null) {
        // No cursor was sent → the server's snapshot is the full recent
        // history (last 50) — replace wholesale rather than dedup-merge
        // (see `hydrateFromMessages`).
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
      if (e.status === "running") return;
      // The job has settled ("active" or "error") — no more in-request
      // `turn_done` to watch for now that every turn runs as a background
      // job (Task A2), so a settled status IS this drawer's "turn is done"
      // signal: re-enable the composer, and — only for a turn THIS
      // instance's `send()` kicked off — fetch the usage delta.
      setSending(false);
      if (pendingUsageRefreshRef.current) {
        pendingUsageRefreshRef.current = false;
        void maybeRefreshUsageDelta(id);
      }
    }
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
        // "running" (bot-review fix wave item 1) means a job-run turn is
        // actively in flight for this conversation — reopening the drawer
        // must still reconnect to it (hydrate + autoTail), not silently
        // ignore it because neither "active" nor "error" matched.
        const existing = res.conversations.find(
          (c) => c.status === "active" || c.status === "error" || c.status === "running",
        );
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
          // Bot-review fix wave (CodeRabbit, hydration-catch unmount hole):
          // this catch previously fell through to `startTail` unconditionally
          // — mirror the other awaits in this effect and bail if the drawer
          // closed/unmounted while the hydration fetch was in flight.
          if (cancelled) return;
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

  /**
   * Task A2 (2026-07-30 lovable-workspace SDD): the messages POST is
   * enqueue-only now — no agent turn ever runs inside an HTTP request
   * (global-constraints.md, Cloud Run's 60s timeout). `send()` just posts
   * the message, gets back `202 {queued, conversation_id}` (or a 409 if a
   * turn's already running), and starts/refreshes the `/events` tail so the
   * transcript fills in from persisted messages as the background job
   * runs. `sending` stays true across that whole window — it's cleared by
   * `handleTailEvent` once the tail reports a settled status, or by `stop()`.
   *
   * The tail is ALWAYS (re)started with a NULL cursor here — mirroring the
   * old inline route's "promoted" restart (see the removed `handleTurnEvent`
   * in git history). The user's own message was just optimistically pushed
   * into `items` as a transient `local-` id, but the SAME message is also
   * now persisted server-side (with a real id) before the 202 responds — a
   * non-null cursor (`lastMessageIdRef.current`, still pointing at whatever
   * came before this send) would hit the cursored MERGE path in
   * `handleTailEvent` and re-append that persisted row as a SECOND bubble.
   * A null cursor takes the full-REPLACE path (`hydrateFromMessages`)
   * instead, rebuilding the transcript from the persisted, authoritative
   * last-50 — no duplicate possible.
   */
  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    setItems((prev) => [...prev, { id: nextId(), kind: "user", text }]);
    const controller = new AbortController();
    sendAbortRef.current = controller;
    usageBeforeRef.current = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
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
      await apiFetch(`/api/sites/${siteId}/agent/conversations/${cid}/messages`, {
        method: "POST",
        body: { message: text },
        signal: controller.signal,
      });
      pendingUsageRefreshRef.current = true;
      startTail(cid, null);
    } catch (err) {
      const aborted = (err as { name?: string } | null)?.name === "AbortError";
      if (aborted) {
        // `stop()` (or the drawer closing) already aborted this and — for
        // an explicit Stop click — already appended "Stopped." and reset
        // `sending` synchronously; nothing left to do once the aborted
        // fetch itself rejects.
        return;
      } else if (err instanceof ApiError && err.status === 409) {
        // Serialized-turn guard (bot-review fix wave item 1): the route
        // rejects a second concurrent turn with 409 rather than interleaving
        // it into the running one. The composer re-enables itself via this
        // catch returning normally into `finally` below.
        setItems((prev) => [
          ...prev,
          { id: nextId(), kind: "system", text: "A build is already running — wait for it to finish." },
        ]);
      } else {
        setError(err instanceof ApiError ? err.message : "Message failed to send.");
      }
      setSending(false);
    } finally {
      sendAbortRef.current = null;
    }
  }

  /**
   * Detaches from the in-flight turn — aborts the enqueue POST if it's still
   * in flight, and (the common case, since that POST resolves almost
   * immediately) aborts the live `/events` tail. Mirrors the old inline
   * route's semantics: even there, a client abort never actually stopped
   * server-side work (`clientGone` only gated SSE writes) — it only stopped
   * the CLIENT from watching. Same trade here: the background job keeps
   * running; this just stops this drawer from following it.
   */
  function stop() {
    if (!sending) return;
    sendAbortRef.current?.abort();
    tailAbortRef.current?.abort();
    pendingUsageRefreshRef.current = false;
    setSending(false);
    setItems((prev) => [...prev, { id: nextId(), kind: "system", text: "Stopped." }]);
  }

  if (!open) return null;

  const usage = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
  const totalToday = usage.input + usage.output;
  const deltaTotal = lastTurnDelta ? lastTurnDelta.input + lastTurnDelta.output : null;
  const usageText = deltaTotal ? `${totalToday} tokens today · +${deltaTotal} this turn` : `${totalToday} tokens today`;
  const showEmptyState = items.length === 0;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
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
        liveTurn={null}
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
