import { useEffect, useRef } from "react";
import type { AgentChangeEvent, AiConversation } from "../lib/agent-api.js";
import { useAgentConversation } from "./agent-chat/useAgentConversation.js";
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

/**
 * Studio chat drawer (P-T11 / design doc §Studio chat; upgraded per the
 * comparative-review worklist against anchor-operations' copilot). The
 * conversation bootstrap/tail/send state machine (Task A2, then Task 10's
 * agent HTTP API) lives in `useAgentConversation` (Task B2, 2026-07-30
 * lovable-workspace SDD — extracted so the new workspace's chat panel can
 * drive the same logic without duplicating it); this component owns only
 * the drawer's OWN concerns: modal dialog semantics (Escape closes it,
 * focus moves to the composer on open and back to whatever had it once
 * closed) and autoscroll-pin (only follow new content when the user was
 * already near the bottom).
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
  const { items, draft, setDraft, sending, conversation, error, usageText, send, stop } = useAgentConversation({
    siteId,
    active: open,
    autoTail,
    onSiteChanged,
    onChangeEvent,
    onStatusChange,
  });

  // Autoscroll pin: only auto-scroll-to-bottom on new content when the user
  // was already near the bottom — don't yank someone reading history
  // (worklist item 2).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

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

  if (!open) return null;

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
        busy={conversation?.status === "running"}
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
