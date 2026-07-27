// src/admin/components/agent-chat/types.ts
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import type { ToolStep } from "./chatReducer.js";

export type AssistantReasoning = {
  stepCount: number;
  seconds: number;
  toolSteps: ToolStep[];
};

export type DisplayItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; reasoning?: AssistantReasoning }
  | { id: string; kind: "change"; change: AgentChangeEvent }
  // A centered, amber caption — connection errors, and turn_done reasons
  // that aren't a clean end_turn (budget / max_tools / error), plus "Stopped."
  // when the user aborts an in-flight turn (worklist items 4 + 8).
  | { id: string; kind: "system"; text: string };
