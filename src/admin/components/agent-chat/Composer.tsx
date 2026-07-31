// src/admin/components/agent-chat/Composer.tsx
//
// The message box: Enter sends, Shift+Enter inserts a newline, the textarea
// auto-grows from 1 to 5 rows, and the Send button becomes a Stop button
// while a turn is in flight (worklist items 4 + 5).
//
// Task B6 (2026-07-30 lovable-workspace SDD, Lovable-grade visual pass): the
// composer is now a floating, hairline-bordered rounded-2xl box with a soft
// shadow — Lovable's own chat-input anatomy — instead of a plain bordered
// textarea with separate Send/Stop `<Button>`s below it. Send/Stop are now a
// single compact icon button inside the box's bottom-right corner —
// `aria-label` keeps the same accessible name ("Send"/"Stop") the tests key
// off, so nothing observable changed except the visual.

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/cn.js";

const MAX_ROWS = 5;
// Matches `text-sm leading-5` (20px line-height). The textarea itself now
// carries no vertical padding of its own (the padding lives on the wrapping
// box), so unlike the pre-B6 version this is 0, not 16.
const LINE_HEIGHT_PX = 20;
const VERTICAL_PADDING_PX = 0;

export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  sending,
  busy,
  resumeVisible,
  onResume,
  usageText,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  /** W1.4 / D319 — a turn is in flight (local send OR a server-reported
   * running build, e.g. one reconnected to after a reload). The composer
   * visibly disables itself and offers Stop: previously Enter silently
   * no-op'd while running, and a reconnected build showed a Send button
   * whose click could only 409. */
  busy?: boolean;
  resumeVisible: boolean;
  onResume: () => void;
  usageText: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = busy || sending;

  // Auto-grow 1→5 rows, then scroll internally past that.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = LINE_HEIGHT_PX * MAX_ROWS + VERTICAL_PADDING_PX;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [draft]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="p-4">
      {resumeVisible && (
        <Button type="button" variant="secondary" size="sm" className="mb-2" onClick={onResume} disabled={sending}>
          Resume
        </Button>
      )}
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm transition focus-within:border-zinc-300 focus-within:shadow-md">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={inFlight}
          placeholder={
            inFlight
              ? "A build is running — press Stop, or wait for it to finish…"
              : "Ask Anchor to change anything…"
          }
          className="w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">{usageText}</span>
          {inFlight ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700"
            >
              <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              onClick={onSend}
              disabled={!draft.trim()}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700",
                "disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400",
              )}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
