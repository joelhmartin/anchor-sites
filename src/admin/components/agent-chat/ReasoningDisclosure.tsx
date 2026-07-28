// src/admin/components/agent-chat/ReasoningDisclosure.tsx
//
// The collapsed "how I got there" toggle that sits above a finalized
// assistant bubble once its turn used at least one tool. Default collapsed —
// the transcript reads as a clean conversation, and the tool-step trace is
// one click away. Ported from anchor-operations' copilot
// (`copilot/ReasoningDisclosure.jsx`), retextured for Tailwind zinc/indigo.

import { useState } from "react";
import type { ToolStep } from "./chatReducer.js";

export function ReasoningDisclosure({ summary, toolSteps }: { summary: string; toolSteps: ToolStep[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
          />
        </svg>
        {summary}
      </button>
      {open && (
        <div className="ml-1 mt-1 border-l-2 border-zinc-200 pl-2.5">
          {toolSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 py-[2px]">
              <svg viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] shrink-0 text-green-600" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  fill="currentColor"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L9 10.94 7.28 9.22a.75.75 0 0 0-1.06 1.06l2.25 2.25c.3.3.77.3 1.06 0l4.25-4.25Z"
                />
              </svg>
              <span className="text-xs text-zinc-500">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
