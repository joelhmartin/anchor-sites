// src/admin/components/agent-chat/ChatTranscript.tsx
//
// The message list + the live, still-streaming turn. Bubble asymmetry
// (worklist item 10) mirrors anchor-operations' copilot
// (`copilot/ChatTranscript.jsx`): the user gets a filled, right-aligned
// bubble with an asymmetric corner; the assistant gets NO bubble — just a
// small sparkle gutter icon and flowing text — so the transcript reads like
// a conversation, not a chat-widget mockup.

import type { Ref } from "react";
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import type { TurnState } from "./chatReducer.js";
import type { DisplayItem } from "./types.js";
import { ChangeCard } from "./ChangeCard.js";
import { ReasoningDisclosure } from "./ReasoningDisclosure.js";
import { Markdown } from "./Markdown.js";
import { ToolStepRow, TypingPulse } from "./ToolSteps.js";
import { SparkleIcon } from "./icons.js";

// 260ms cubic-bezier(0.16,1,0.3,1) enter animation (worklist item 10),
// motion-reduce-safe. Framework-agnostic inline `<style>` rather than a
// Tailwind config edit — keeps the whole port self-contained in this folder.
const ENTER_ANIMATION_STYLE = `
@keyframes agent-chat-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.agent-chat-enter { animation: agent-chat-enter 260ms cubic-bezier(0.16, 1, 0.3, 1); }
@media (prefers-reduced-motion: reduce) {
  .agent-chat-enter { animation: none; }
}
`;

function UserBubble({ text }: { text: string }) {
  return (
    <div className="agent-chat-enter ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-[10px_10px_4px_10px] bg-zinc-900 px-3 py-2 text-sm leading-[1.5] text-white">
      {text}
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<DisplayItem, { kind: "assistant" }> }) {
  const reasoning = item.reasoning;
  return (
    <div className="agent-chat-enter max-w-[92%]">
      {reasoning && reasoning.stepCount > 0 && (
        <ReasoningDisclosure
          summary={`Worked through ${reasoning.stepCount} step${reasoning.stepCount === 1 ? "" : "s"} · ${reasoning.seconds}s`}
          toolSteps={reasoning.toolSteps}
        />
      )}
      <div className="flex items-start gap-2">
        <SparkleIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
        <Markdown>{item.text || "…"}</Markdown>
      </div>
    </div>
  );
}

function SystemLine({ text }: { text: string }) {
  return <p className="my-1.5 px-2 text-center text-xs text-amber-600">{text}</p>;
}

/** The live, still-streaming turn — tool steps (spinner → check), the
 * in-progress coalesced answer text (plain, NOT markdown — see Markdown.tsx's
 * comment), and the typing pulse. */
function LiveTurn({ turn }: { turn: TurnState }) {
  return (
    <div className="mb-1">
      {turn.toolSteps.length > 0 && (
        <div className="mb-1 pl-0.5">
          {turn.toolSteps.map((step, i) => (
            <ToolStepRow key={i} step={step} />
          ))}
        </div>
      )}
      {turn.text && (
        <div className="flex items-start gap-2">
          <SparkleIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <p className="whitespace-pre-wrap text-sm leading-[1.55] text-zinc-600">{turn.text}</p>
        </div>
      )}
      <TypingPulse />
    </div>
  );
}

export function ChatTranscript({
  items,
  liveTurn,
  siteId,
  slug,
  onSiteChanged,
  scrollRef,
  onScroll,
}: {
  items: DisplayItem[];
  liveTurn: TurnState | null;
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
      aria-live="polite"
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <style>{ENTER_ANIMATION_STYLE}</style>
      {items.map((item) => {
        if (item.kind === "user") return <UserBubble key={item.id} text={item.text} />;
        if (item.kind === "assistant") return <AssistantMessage key={item.id} item={item} />;
        if (item.kind === "system") return <SystemLine key={item.id} text={item.text} />;
        return (
          <ChangeCard
            key={item.id}
            siteId={siteId}
            slug={slug}
            change={item.change as AgentChangeEvent}
            onSiteChanged={onSiteChanged}
          />
        );
      })}
      {liveTurn && <LiveTurn turn={liveTurn} />}
    </div>
  );
}
