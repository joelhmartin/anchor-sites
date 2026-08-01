// src/admin/components/agent-chat/ChatTranscript.tsx
//
// The message list + the live, still-streaming turn. Bubble asymmetry
// (worklist item 10) mirrors anchor-operations' copilot
// (`copilot/ChatTranscript.jsx`): the user gets a filled, right-aligned
// bubble with an asymmetric corner; the assistant gets NO bubble — just a
// small sparkle gutter icon and flowing text — so the transcript reads like
// a conversation, not a chat-widget mockup.

import { useState, type Ref } from "react";
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import type { DisplayItem } from "./types.js";
import { ChangeCard } from "./ChangeCard.js";
import { Markdown } from "./Markdown.js";
import { ToolStepRow, TypingPulse } from "./ToolSteps.js";
import { SparkleIcon } from "./icons.js";

// 260ms cubic-bezier(0.16,1,0.3,1) enter animation (worklist item 10),
// motion-reduce-safe. Framework-agnostic inline `<style>` rather than a
// Tailwind config edit — keeps the whole port self-contained in this folder.
// Task B6 (2026-07-30 lovable-workspace SDD) adds the running-tool-step
// shimmer here too (`ToolSteps.tsx`'s `.agent-chat-step-running`) — one
// style tag for the whole transcript rather than one per row.
const ENTER_ANIMATION_STYLE = `
@keyframes agent-chat-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.agent-chat-enter { animation: agent-chat-enter 260ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes agent-chat-step-shimmer {
  0% { background-position: -80px 0; }
  100% { background-position: 80px 0; }
}
.agent-chat-step-running {
  background-image: linear-gradient(90deg, transparent, rgba(24, 24, 27, 0.05), transparent);
  background-size: 80px 100%;
  background-repeat: no-repeat;
  animation: agent-chat-step-shimmer 1.3s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .agent-chat-enter { animation: none; }
  .agent-chat-step-running { animation: none; }
}
`;

// Task B6 — Lovable's user bubble is a subtle gray, not a solid near-black
// slab (the operator's screenshot flagged the pre-B6 `bg-zinc-900` version
// by name). Plain `rounded-xl`, no asymmetric corner.
function UserBubble({ text }: { text: string }) {
  return (
    <div className="agent-chat-enter ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-zinc-100 px-3.5 py-2 text-sm leading-[1.5] text-zinc-900">
      {text}
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<DisplayItem, { kind: "assistant" }> }) {
  return (
    <div className="agent-chat-enter max-w-[92%]">
      <div className="flex items-start gap-2">
        <SparkleIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
        {/* D320 — the ANSWER is what a screen reader should announce. The
            live region is scoped here (and on SystemLine) rather than on the
            whole scroll container, so the dozens of tool-step appends and
            running→done flips a build produces no longer drown it out. */}
        <div aria-live="polite" className="min-w-0">
          <Markdown>{item.text || "…"}</Markdown>
        </div>
      </div>
    </div>
  );
}

// D320 — `role="status"` is an implicit polite live region: system captions
// (errors, "Stopped.", stall notes) deserve announcement; nothing else in
// the transcript container does.
function SystemLine({ text }: { text: string }) {
  return (
    <p role="status" className="my-1.5 px-2 text-center text-xs text-amber-600">
      {text}
    </p>
  );
}

/**
 * D327 — collapse a run of consecutive tool-step rows.
 *
 * Since Task A2 every tool call is a permanent transcript row, so a 20-tool
 * build left ~20 trace rows around each answer forever — defeating the
 * "clean conversation" design the now-deleted `ReasoningDisclosure` existed
 * for. This restores that: while any step in the group is still running the
 * rows stay expanded (live progress), and the moment they've all settled the
 * group folds into a one-line "Worked through N steps" disclosure (default
 * collapsed; any error is surfaced in the summary so a failure can't hide).
 */
function StepGroup({ steps }: { steps: Extract<DisplayItem, { kind: "step" }>[] }) {
  const anyRunning = steps.some((s) => s.state === "running");
  const anyError = steps.some((s) => s.state === "error");
  const [open, setOpen] = useState(false);

  if (anyRunning) {
    return (
      <div className="flex flex-col gap-0.5">
        {steps.map((s) => (
          <ToolStepRow key={s.id} step={s} />
        ))}
      </div>
    );
  }

  return (
    <div className="agent-chat-enter">
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
        {anyError ? (
          <span className="text-amber-600">
            Worked through {steps.length} step{steps.length === 1 ? "" : "s"} · a step failed
          </span>
        ) : (
          <span>
            Worked through {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-1 mt-1 flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-2.5">
          {steps.map((s) => (
            <ToolStepRow key={s.id} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Coalesce `items` so consecutive `step` items render as one `StepGroup`
 * (D327) while everything else keeps its own row, order preserved. */
type Renderable =
  | { kind: "item"; item: DisplayItem }
  | { kind: "steps"; steps: Extract<DisplayItem, { kind: "step" }>[] };

function groupItems(items: DisplayItem[]): Renderable[] {
  const out: Renderable[] = [];
  for (const item of items) {
    if (item.kind === "step") {
      const last = out[out.length - 1];
      if (last && last.kind === "steps") last.steps.push(item);
      else out.push({ kind: "steps", steps: [item] });
    } else {
      out.push({ kind: "item", item });
    }
  }
  return out;
}

/**
 * Fix round 1 (Finding 2 — reviewer, Task A2): every chat turn now runs as
 * a background job with no in-request event stream to drive a transient
 * "live turn" bubble (the old `LiveTurn`/`TurnState` machinery this
 * replaced — see git history — was already permanently unreachable once
 * Task A2 landed: `liveTurn` was hardcoded to `null`). Progress instead
 * comes from the SAME tailed `ai_messages` rows as everything else in
 * `items`: a tool_use block derives a `"step"` item (spinner) the moment
 * the tail delivers the assistant message that persisted it; the matching
 * tool_result flips it to done/error in place (`history.ts`). `busy`
 * (conversation `status === "running"`) is the one thing that still needs
 * a dedicated indicator — there's no persisted row for "the model is still
 * thinking" — so it reuses the same typing pulse the old live turn showed.
 */
export function ChatTranscript({
  items,
  busy,
  siteId,
  slug,
  onSiteChanged,
  scrollRef,
  onScroll,
}: {
  items: DisplayItem[];
  busy: boolean;
  siteId: string;
  slug: string;
  onSiteChanged: () => void;
  scrollRef: Ref<HTMLDivElement>;
  onScroll: () => void;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // D320 — deliberately NOT a live region (and NOT role="log", which
      // implies aria-live). Announcement is scoped to the assistant answer
      // and system captions instead (AssistantMessage / SystemLine); tool
      // steps announce nothing (their running state is exposed via
      // aria-busy on the row, not by insertion into a live region).
      // `min-h-0` is load-bearing: without it, a flex child defaults to
      // `min-height: auto` (its content height), which stops it from ever
      // shrinking below the transcript's full content height — so
      // `overflow-y-auto` never actually engages and the composer/whole
      // rail gets pushed off-screen instead of the transcript scrolling
      // (the "chat is not scrollable" bug — screenshot-driven follow-up).
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <style>{ENTER_ANIMATION_STYLE}</style>
      {groupItems(items).map((r) => {
        if (r.kind === "steps") return <StepGroup key={`steps-${r.steps[0].id}`} steps={r.steps} />;
        const item = r.item;
        if (item.kind === "user") return <UserBubble key={item.id} text={item.text} />;
        if (item.kind === "assistant") return <AssistantMessage key={item.id} item={item} />;
        if (item.kind === "system") return <SystemLine key={item.id} text={item.text} />;
        // `step` items were coalesced into `steps` groups above, so the only
        // remaining kind here is `change`.
        if (item.kind !== "change") return null;
        return (
          <ChangeCard
            key={item.id}
            siteId={siteId}
            slug={slug}
            change={item.change as AgentChangeEvent}
            onSiteChanged={onSiteChanged}
            // D328: Revert obeys the same busy gate as Publish/Edit — `busy`
            // here is the hook's sending-or-running signal, the same one
            // WorkspacePage's Publish button disables on.
            agentBusy={busy}
          />
        );
      })}
      {busy && <TypingPulse />}
    </div>
  );
}
