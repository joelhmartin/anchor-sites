// src/admin/components/agent-chat/Composer.tsx
//
// The message box: Enter sends, Shift+Enter inserts a newline, the textarea
// auto-grows from 1 to 5 rows, and the Send button becomes a Stop button
// while a turn is in flight (worklist items 4 + 5).

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "../../ui/button.js";

const MAX_ROWS = 5;
// Matches `text-sm leading-5` (20px line-height) + the textarea's `p-2` (8px top + 8px bottom).
const LINE_HEIGHT_PX = 20;
const VERTICAL_PADDING_PX = 16;

export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  sending,
  resumeVisible,
  onResume,
  usageText,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  resumeVisible: boolean;
  onResume: () => void;
  usageText: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    <div className="border-t border-zinc-200 p-4">
      {resumeVisible && (
        <Button type="button" variant="secondary" size="sm" className="mb-2" onClick={onResume} disabled={sending}>
          Resume
        </Button>
      )}
      <textarea
        ref={textareaRef}
        aria-label="Message"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="Tell the agent what to build or change… (Enter to send, Shift+Enter for a new line)"
        className="w-full resize-none overflow-y-auto rounded border border-zinc-300 p-2 text-sm leading-5"
      />
      <div className="mt-2 flex items-center justify-between">
        {sending ? (
          <Button type="button" variant="outline" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="button" onClick={onSend} disabled={!draft.trim()}>
            Send
          </Button>
        )}
        <span className="text-xs text-zinc-400">{usageText}</span>
      </div>
    </div>
  );
}
