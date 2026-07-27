// src/admin/components/agent-chat/ChatTranscript.tsx
//
// The message list + the live, still-streaming turn.

import type { Ref } from "react";
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import type { TurnState } from "./chatReducer.js";
import type { DisplayItem } from "./types.js";
import { ChangeCard } from "./ChangeCard.js";
import { ReasoningDisclosure } from "./ReasoningDisclosure.js";
import { ToolStepRow, TypingPulse } from "./ToolSteps.js";

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white">
      {text}
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<DisplayItem, { kind: "assistant" }> }) {
  const reasoning = item.reasoning;
  return (
    <div className="max-w-[92%]">
      {reasoning && reasoning.stepCount > 0 && (
        <ReasoningDisclosure
          summary={`Worked through ${reasoning.stepCount} step${reasoning.stepCount === 1 ? "" : "s"} · ${reasoning.seconds}s`}
          toolSteps={reasoning.toolSteps}
        />
      )}
      <p className="whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
        {item.text || "…"}
      </p>
    </div>
  );
}

function SystemLine({ text }: { text: string }) {
  return <p className="my-1.5 px-2 text-center text-xs text-amber-600">{text}</p>;
}

/** The live, still-streaming turn — tool steps (spinner -> check), the
 * in-progress coalesced answer text, and the typing pulse. */
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
      {turn.text && <p className="whitespace-pre-wrap text-sm leading-[1.55] text-zinc-600">{turn.text}</p>}
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
