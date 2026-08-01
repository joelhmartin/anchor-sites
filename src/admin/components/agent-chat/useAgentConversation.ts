// src/admin/components/agent-chat/useAgentConversation.ts
//
// Task B2 (2026-07-30 lovable-workspace SDD): the conversation/tail state
// machine that used to live entirely inside `AgentChatDrawer` — bootstrap
// (list → newest active/error/running, or lazily create on first send),
// history hydration, the `/events` tail (snapshot replace-or-merge depending
// on whether a cursor was sent, tool-result → step resolution, status →
// busy), send/stop, and the per-turn token-usage delta. Extracted so BOTH
// the drawer (unchanged behavior — see `AgentChatDrawer.tsx`) and the new
// workspace's always-on chat panel (`WorkspacePage.tsx`) can drive the same
// logic instead of duplicating several hundred lines of it.
//
// What did NOT move here (stays host-specific, in each component that uses
// this hook): scroll-position pinning, and the drawer's modal-only concerns
// (Escape-to-close, focus trap/restore) — those are UI-integration details
// of the HOST, not of the conversation itself.

import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../../lib/apiFetch.js";
import {
  streamAgentEvents,
  type AgentChangeEvent,
  type AgentTailEvent,
  type AiConversation,
  type AiMessage,
} from "../../lib/agent-api.js";
import { deriveItemsFromMessage, deriveItemsFromMessages, deriveToolResultUpdates } from "./history.js";
import type { DisplayItem } from "./types.js";

export type UseAgentConversationOptions = {
  siteId: string;
  /** Whether this hook instance should be bootstrapping/tailing at all —
   * the drawer passes its `open` prop; a permanently-visible host (the
   * workspace panel) passes `true`. */
  active: boolean;
  /** Reconnect (hydrate + start tailing) an already-running/erroring
   * conversation found on bootstrap, not just on an explicit `send()`. */
  autoTail?: boolean;
  onSiteChanged: () => void;
  onChangeEvent?: (c: AgentChangeEvent) => void;
  onStatusChange?: (status: AiConversation["status"] | null, busy: boolean) => void;
};

export type UseAgentConversationResult = {
  items: DisplayItem[];
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  /** True while a turn is in flight from the operator's point of view:
   * `sending` (D310 — feedback starts at Send, not at the 2-4s-later
   * pg-boss pickup) OR a server-reported running build (including one this
   * hook merely reconnected to). */
  busy: boolean;
  /** D1118 — the live tail has dropped repeatedly and is auto-retrying;
   * hosts surface a "reconnecting…" line so the build doesn't look frozen. */
  reconnecting: boolean;
  error: string | null;
  conversation: AiConversation | null;
  /** Formatted footer text, e.g. "123 tokens today · +45 this turn". */
  usageText: string;
  send: (overrideText?: string) => Promise<void>;
  stop: () => void;
  /** D1104/D108 — archive the current conversation and reset to a fresh one
   * ("New conversation"). The next `send()` get-or-creates a new thread. */
  newConversation: () => Promise<void>;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * How long a settled (non-'running', non-'error') status is HELD before it's
 * accepted as "the turn is over" — see `handleTailEvent`'s status branch.
 *
 * FINAL whole-branch review, FIX-NOW item 1: the auto-continue loop releases
 * the conversation lock (status → 'active') BEFORE enqueueing the next
 * round's job, and pg-boss polls on a ~2s interval, so the row genuinely
 * reads 'active' for 1-3s BETWEEN rounds of a build that is very much still
 * running. Accepting that downgrade instantly made the whole tail flicker
 * up to 3× per build: the typing pulse stopped, the composer flipped
 * Stop→Send, and WorkspacePage's Publish button re-enabled mid-build (a
 * click there would have shipped a half-finished site). 4s comfortably
 * covers the observed 1-3s gap while still being short enough that a genuine
 * end-of-build doesn't feel stuck.
 */
const SETTLE_DEBOUNCE_MS = 4000;

export function useAgentConversation({
  siteId,
  active,
  autoTail,
  onSiteChanged,
  onChangeEvent,
  onStatusChange,
}: UseAgentConversationOptions): UseAgentConversationResult {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
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
  // A `send()` marks this true right before starting its tail, and clears it
  // when that tail's settle is ACCEPTED (i.e. after the debounce below, so
  // an inter-round 'active' that's immediately followed by another 'running'
  // never consumes it) — that's the signal to fetch the per-turn token-usage
  // delta (only for a turn THIS hook instance kicked off, not e.g. an
  // unrelated autoTail observing someone else's job). Item 1 of the final
  // review: firing on the FIRST settle made "+N this turn" report only round
  // 0's tokens for a multi-round build; it must be the FINAL settle.
  const pendingUsageRefreshRef = useRef(false);
  // Pending debounced settle (see `SETTLE_DEBOUNCE_MS`). Non-null only while
  // a non-'running' status is being held.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageBeforeRef = useRef<{ input: number; output: number }>({ input: 0, output: 0 });

  function nextId(): string {
    idCounter.current += 1;
    return `local-${idCounter.current}`;
  }

  function noteChange(change: AgentChangeEvent) {
    onSiteChanged();
    onChangeEvent?.(change);
  }

  // Reports status/busy on every change to `conversation` or `sending` so a
  // caller (site-detail's inline editor readonly guard, the workspace's
  // preview-readonly guard) can gate itself while a turn is actively
  // running. `onStatusChange` is intentionally left out of the dep array —
  // it's typically a fresh closure each render, and re-invoking on identity
  // change alone (with unchanged status/busy) would just be redundant work.
  useEffect(() => {
    const status = conversation?.status ?? null;
    const busy = sending || status === "running";
    onStatusChange?.(status, busy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.status, sending]);

  /**
   * Replace the transcript with the authoritative persisted history. Used
   * for (a) hydrating an existing conversation's history on activation/
   * reactivation, and (b) a tail's initial `snapshot` on a never-hydrated
   * conversation (the client has no message ids to scope `after=` to until
   * it has hydrated at least once). Does NOT fire `onSiteChanged`/
   * `onChangeEvent` — a replay of history being (re)opened to read
   * shouldn't re-trigger site-changed side effects.
   */
  function hydrateFromMessages(messages: AiMessage[]) {
    // `deriveItemsFromMessages` (not the per-message singular) resolves any
    // tool_use "step" against its tool_result within this same batch, so a
    // step from earlier history doesn't get stuck showing "running" forever.
    setItems(deriveItemsFromMessages(messages));
    seenMessageIdsRef.current = new Set(messages.map((m) => m.id));
    const last = messages[messages.length - 1];
    if (last) lastMessageIdRef.current = last.id;
  }

  /**
   * Append one newly-tailed persisted message, deduped by id.
   *
   * A `role:"tool"` message's `tool_result`s don't just derive NEW items
   * (the existing `change` cards) — they also resolve an EARLIER message's
   * `tool_use` "step" item that's already sitting in `items` at
   * `state:"running"`. `deriveToolResultUpdates` reports which
   * `toolCallId`s to flip and to what; applied here via a map over the
   * current items BEFORE appending whatever new items this same message
   * also derives (a change card, mainly — a message is never both an
   * assistant tool_use message and a tool tool_result message at once, so
   * in practice at most one of the two branches below does anything per
   * call, but there's no reason to assume that structurally).
   */
  function appendPersistedMessage(message: AiMessage) {
    if (seenMessageIdsRef.current.has(message.id)) return;
    seenMessageIdsRef.current.add(message.id);
    lastMessageIdRef.current = message.id;

    const updates = deriveToolResultUpdates(message);
    const derived = deriveItemsFromMessage(message);
    if (updates.length === 0 && derived.length === 0) return;

    setItems((prev) => {
      const withUpdates =
        updates.length === 0
          ? prev
          : prev.map((item) => {
              if (item.kind !== "step") return item;
              const update = updates.find((u) => u.toolCallId === item.toolCallId);
              return update ? { ...item, state: update.state } : item;
            });
      return derived.length > 0 ? [...withUpdates, ...derived] : withUpdates;
    });
    for (const item of derived) if (item.kind === "change") noteChange(item.change);
  }

  function startTail(id: string, afterId: string | null) {
    tailAbortRef.current?.abort();
    const controller = new AbortController();
    tailAbortRef.current = controller;
    void runTail(id, afterId, controller);
  }

  /** Abort-aware sleep for the reconnect backoff — resolves early (and
   * cleanly) the moment the tail is aborted. */
  function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        signal.removeEventListener("abort", done);
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener("abort", done);
    });
  }

  /**
   * W1.4 / D1118 — the tail used to be `streamAgentEvents(...).catch(() =>
   * {})`: any connection drop (proxy timeout, laptop sleep, server restart)
   * silently froze the transcript mid-build with no retry and no notice.
   * Now every drop — rejection OR a server-side close — reconnects with
   * exponential backoff (1s → 15s cap), resuming from `lastMessageIdRef` so
   * nothing already-displayed is refetched or lost. A single blip retries
   * silently; from the second consecutive failure on, `reconnecting`
   * surfaces so the build doesn't look frozen. Any delivered event proves
   * the pipe works again and resets both the backoff and the surface.
   */
  async function runTail(id: string, initialAfterId: string | null, controller: AbortController) {
    let afterId = initialAfterId;
    let attempt = 0;
    for (;;) {
      // `afterId` is captured per-connection: the server's `snapshot`
      // payload shape depends on whether `after=` was sent (only messages
      // newer than it; else the last 50), so the handler needs to know
      // which one this connection used.
      const cursor = afterId;
      const qs = cursor ? `?after=${cursor}` : "";
      try {
        await streamAgentEvents(`/api/sites/${siteId}/agent/conversations/${id}/events${qs}`, {
          signal: controller.signal,
          onEvent: (e) => {
            attempt = 0;
            setReconnecting(false);
            handleTailEvent(e as AgentTailEvent, cursor, id);
          },
        });
        // Resolved without abort: the server closed the stream (restart/
        // deploy). Fall through to the same reconnect path as a rejection.
      } catch {
        // Connection dropped or aborted — the checks below decide which.
      }
      if (controller.signal.aborted) {
        setReconnecting(false);
        return;
      }
      attempt += 1;
      if (attempt >= 2) setReconnecting(true);
      await abortableSleep(Math.min(1000 * 2 ** (attempt - 1), 15_000), controller.signal);
      if (controller.signal.aborted) {
        setReconnecting(false);
        return;
      }
      // Cursor resume: pick up right after the newest message already shown.
      afterId = lastMessageIdRef.current ?? afterId;
    }
  }

  /** Best-effort per-turn token-usage delta for a turn THIS hook instance
   * kicked off — see `pendingUsageRefreshRef`'s doc comment. */
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

  function clearSettleTimer() {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }

  /**
   * Accept a settled status: publish it onto `conversation`, re-enable the
   * composer, and — only for a turn THIS instance's `send()` kicked off —
   * fetch the usage delta. Called immediately for 'error', and via the
   * `SETTLE_DEBOUNCE_MS` timer for every other settled status.
   */
  function applySettledStatus(status: AiConversation["status"], id: string) {
    setConversation((prev) => (prev ? { ...prev, status } : prev));
    setSending(false);
    if (pendingUsageRefreshRef.current) {
      pendingUsageRefreshRef.current = false;
      void maybeRefreshUsageDelta(id);
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
        // this tail started (e.g. reactivating on an existing conversation
        // with `autoTail` — history was hydrated from the conversation-
        // detail fetch, then the tail's own snapshot must ADD to it, not
        // erase it).
        for (const m of e.messages) appendPersistedMessage(m);
      }
    } else if (e.type === "message") {
      appendPersistedMessage(e.message);
    } else if (e.type === "status") {
      // Item 1 (final review) — inter-round busy flicker. Three cases:
      //
      //  'running' : apply immediately AND cancel any held settle. This is
      //              the round-N+1 pickup that proves the previous 'active'
      //              was just the auto-continue loop's release-before-
      //              enqueue gap, not the end of the build.
      //  'error'   : apply immediately, never debounced — an error carries a
      //              labeled message the operator needs to see now, and
      //              nothing ever "un-errors" back into 'running'.
      //  otherwise : HOLD for SETTLE_DEBOUNCE_MS. `conversation.status` stays
      //              'running' for the duration, so `busy` (and therefore
      //              the typing pulse, the Stop button, and WorkspacePage's
      //              Publish gate) never blinks off between rounds.
      if (e.status === "running") {
        clearSettleTimer();
        setConversation((prev) => (prev ? { ...prev, status: e.status } : prev));
        return;
      }
      clearSettleTimer();
      // 'stopped' (W1.4 real Stop) is as terminal as 'error': the server
      // already persisted the "Stopped by you" note, nothing ever un-stops
      // back into 'running', and the operator is actively waiting for the
      // halt to confirm — never debounce it.
      if (e.status === "error" || e.status === "stopped") {
        applySettledStatus(e.status, id);
        return;
      }
      const settled = e.status;
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        applySettledStatus(settled, id);
      }, SETTLE_DEBOUNCE_MS);
    }
  }

  // Load (or note) the site's conversation on activation. If one already
  // exists, hydrate the transcript from its persisted history (GET
  // .../:id → { conversation, messages }) BEFORE wiring up any live sends,
  // so reactivating doesn't show a blank transcript. `autoTail` then
  // additionally starts a live tail from that hydrated point on.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ conversations: AiConversation[] }>(
          `/api/sites/${siteId}/agent/conversations`,
        );
        if (cancelled) return;
        // "running" means a job-run turn is actively in flight for this
        // conversation — reactivating must still reconnect to it (hydrate
        // + autoTail), not silently ignore it because neither "active" nor
        // "error" matched.
        const existing = res.conversations.find(
          (c) =>
            c.status === "active" || c.status === "error" || c.status === "running" ||
            c.status === "stopped",
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
            // D303 — an errored conversation must explain its Resume button
            // on reload. Newer failure paths persist a system row already;
            // for histories that trail off without one (older failures,
            // partial writes), derive the line client-side. Skipped when the
            // last persisted row IS a system explanation — no doubling up.
            const lastMessage = detail.messages[detail.messages.length - 1];
            if (detail.conversation.status === "error" && lastMessage?.role !== "system") {
              setItems((prev) => [
                ...prev,
                {
                  id: nextId(),
                  kind: "system",
                  text: "The last build ended with an error — press Resume to continue.",
                },
              ]);
            }
          } catch {
            // history hydration is best-effort — sends still work regardless
          }
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
  }, [active, siteId]);

  // Abort any in-flight tail AND any in-flight turn when the host
  // deactivates or unmounts. The held settle timer (item 1) goes with them —
  // it would otherwise fire into an unmounted hook.
  useEffect(() => {
    if (!active) {
      tailAbortRef.current?.abort();
      sendAbortRef.current?.abort();
      clearSettleTimer();
    }
    return () => {
      tailAbortRef.current?.abort();
      sendAbortRef.current?.abort();
      clearSettleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /**
   * The messages POST is enqueue-only — no agent turn ever runs inside an
   * HTTP request (global-constraints.md, Cloud Run's 60s timeout).
   * `send()` just posts the message, gets back `202 {queued,
   * conversation_id}` (or a 409 if a turn's already running), and starts/
   * refreshes the `/events` tail so the transcript fills in from persisted
   * messages as the background job runs. `sending` stays true across that
   * whole window — it's cleared by `handleTailEvent` once the tail reports
   * a settled status, or by `stop()`.
   *
   * The tail is (re)started with the `user_message_id` the 202 response
   * returns — the real, persisted id of the message THIS send just
   * appended — NOT a null cursor. A null cursor hits the tail route's
   * no-cursor branch (capped at the last 50 rows), which wholesale-
   * REPLACES the transcript from just that capped window: fine for a first
   * send, but a silent, view-only history-truncation bug from the second
   * send onward in any conversation with >50 persisted rows. A cursor
   * scoped to right before this turn's own messages MERGES instead —
   * nothing already on screen is discarded.
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
    let cid = conversationId;
    try {
      if (!cid) {
        const created = await apiFetch<{ conversation: AiConversation }>(
          `/api/sites/${siteId}/agent/conversations`,
          { method: "POST" },
        );
        cid = created.conversation.id;
        setConversationId(cid);
        setConversation(created.conversation);
      }
      const posted = await apiFetch<{ user_message_id?: string }>(
        `/api/sites/${siteId}/agent/conversations/${cid}/messages`,
        {
          method: "POST",
          body: { message: text },
          signal: controller.signal,
        },
      );
      pendingUsageRefreshRef.current = true;
      // `?? null` is a defensive fallback only — every real 202 carries
      // `user_message_id`; falling back to the (safe, if history-
      // truncating) null-cursor replace path rather than throwing keeps a
      // malformed/mocked response non-fatal.
      startTail(cid, posted.user_message_id ?? null);
    } catch (err) {
      const aborted = (err as { name?: string } | null)?.name === "AbortError";
      if (aborted) {
        // `stop()` (or deactivation) already aborted this and — for an
        // explicit Stop click — already appended "Stopped." and reset
        // `sending` synchronously; nothing left to do once the aborted
        // fetch itself rejects.
        return;
      } else if (err instanceof ApiError && err.status === 409) {
        // Serialized-turn guard: the route rejects a second concurrent
        // turn with 409 rather than interleaving it into the running one.
        // The composer re-enables itself via this catch returning normally
        // into `finally` below.
        setItems((prev) => [
          ...prev,
          { id: nextId(), kind: "system", text: "A build is already running — wait for it to finish." },
        ]);
        // D300 follow-up: reattach to the running turn instead of leaving a
        // dead tail next to a 409 (previously only a full reload recovered).
        if (cid) startTail(cid, lastMessageIdRef.current);
      } else {
        setError(err instanceof ApiError ? err.message : "Message failed to send.");
      }
      setSending(false);
    } finally {
      sendAbortRef.current = null;
    }
  }

  /**
   * W1.4 / D300+D1105+D612 — real Stop. The old implementation only aborted
   * the local POST/tail while the background AGENT_TURN job kept executing
   * tools and mutating the site ("the operator believes the build halted;
   * the site keeps changing underneath them") — worse, it stranded `busy`
   * with a dead tail. Now: POST the cancel endpoint and KEEP TAILING — the
   * server-side halt lands the honest "Stopped by you" note + the terminal
   * 'stopped' status, which the tail delivers and `applySettledStatus`
   * applies immediately (re-enabling the composer/Publish). The only
   * client-side abort left is the no-conversation-yet case, where there is
   * nothing server-side to cancel.
   */
  async function stop() {
    const cid = conversationId;
    if (!sending && conversation?.status !== "running") return;
    if (!cid) {
      // Conversation creation still in flight — nothing exists server-side
      // to cancel; aborting the POST is a complete stop.
      sendAbortRef.current?.abort();
      clearSettleTimer();
      pendingUsageRefreshRef.current = false;
      setSending(false);
      setItems((prev) => [...prev, { id: nextId(), kind: "system", text: "Stopped." }]);
      return;
    }
    try {
      const res = await apiFetch<{ stopping: boolean; status?: string }>(
        `/api/sites/${siteId}/agent/conversations/${cid}/stop`,
        { method: "POST" },
      );
      if (res.stopping) {
        setItems((prev) => [
          ...prev,
          { id: nextId(), kind: "system", text: "Stopping — the build will halt at the next step…" },
        ]);
      }
      // If `stopping` is false the turn already settled; the tail delivers
      // (or has delivered) that settled status on its own.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't stop the build.");
    }
  }

  /**
   * D1104/D108 — retire the current conversation and start fresh. Archiving
   * frees the one-per-site slot (D302's unique index), so the next `send()`
   * get-or-creates a brand-new thread instead of forever resuming the same
   * immortal one. Refuses while a build is running (the server's
   * archiveConversation refuses too → 409); a failed archive leaves the slot
   * taken, so we DON'T reset local state in that case.
   */
  async function newConversation() {
    if (conversation?.status === "running" || sending) return;
    const cid = conversationId;
    if (cid) {
      try {
        await apiFetch(`/api/sites/${siteId}/agent/conversations/${cid}`, {
          method: "PATCH",
          body: { status: "archived" },
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't archive this conversation.");
        return;
      }
    }
    tailAbortRef.current?.abort();
    clearSettleTimer();
    setConversationId(null);
    setConversation(null);
    setItems([]);
    setDraft("");
    setError(null);
    lastMessageIdRef.current = null;
    seenMessageIdsRef.current = new Set();
  }

  const usage = conversation?.token_usage?.[todayKey()] ?? { input: 0, output: 0 };
  const totalToday = usage.input + usage.output;
  const deltaTotal = lastTurnDelta ? lastTurnDelta.input + lastTurnDelta.output : null;
  const usageText = deltaTotal ? `${totalToday} tokens today · +${deltaTotal} this turn` : `${totalToday} tokens today`;

  return {
    items,
    draft,
    setDraft,
    sending,
    // D310 — include `sending`, matching what `onStatusChange` already
    // reports: the typing pulse and busy gates start at Send, not at pickup.
    busy: sending || conversation?.status === "running",
    reconnecting,
    error,
    conversation,
    usageText,
    send,
    stop,
    newConversation,
  };
}
