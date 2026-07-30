// src/admin/components/agent-chat/ToolSteps.tsx
//
// Live tool-step rows (spinner → check) and the 3-dot typing pulse shown
// while a turn is streaming. Ported from anchor-operations' copilot
// (`ChatTranscript.jsx`'s `ToolStepRow` / `TypingPulse`), retextured for
// Tailwind zinc/indigo instead of MUI.

import { Spinner } from "../../ui/spinner.js";
import type { ToolStep } from "./chatReducer.js";

/**
 * Fix round 1 (Finding 2 — reviewer, Task A2): a third `state:"error"`
 * (`chatReducer.ts`) needed a distinct icon here now that a failed tool
 * call is a permanent, always-visible transcript row (no more collapsed
 * "Worked through N steps" disclosure a failure could hide inside — Task
 * A2 deleted the in-request event stream that fed it).
 */
export function ToolStepRow({ step }: { step: ToolStep }) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="flex w-4 shrink-0 items-center justify-center">
        {step.state === "done" ? (
          <svg viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] text-green-600" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              fill="currentColor"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L9 10.94 7.28 9.22a.75.75 0 0 0-1.06 1.06l2.25 2.25c.3.3.77.3 1.06 0l4.25-4.25Z"
            />
          </svg>
        ) : step.state === "error" ? (
          <svg viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] text-red-600" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              fill="currentColor"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 1 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
            />
          </svg>
        ) : (
          <Spinner className="h-3 w-3 border-[1.5px]" />
        )}
      </span>
      <span className={step.state === "running" ? "text-xs font-medium text-zinc-900" : "text-xs text-zinc-500"}>
        {step.label}
      </span>
    </div>
  );
}

export function TypingPulse() {
  return (
    <div className="flex items-center gap-1.5 py-1.5 pl-0.5" role="status" aria-label="assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 opacity-70 motion-reduce:animate-none motion-reduce:opacity-50"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}
