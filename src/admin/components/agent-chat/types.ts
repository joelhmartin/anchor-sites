// src/admin/components/agent-chat/types.ts
import type { AgentChangeEvent } from "../../lib/agent-api.js";
import type { ToolStep } from "./chatReducer.js";

export type DisplayItem =
  | { id: string; kind: "user"; text: string }
  // D327 — the `reasoning` field (and its `ReasoningDisclosure` renderer)
  // was dead since Task A2: `history.ts` never populated it. Tool steps now
  // collapse via `ChatTranscript`'s `StepGroup` instead, driven by the same
  // persisted `step` items.
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "change"; change: AgentChangeEvent }
  // Fix round 1 (Finding 2 — reviewer, Task A2): a tool call/result tailed
  // from persisted `ai_messages` rows, rendered as a visible progress step
  // (spinner while `state:"running"`, check/x once the matching tool_result
  // lands) — the only mid-turn feedback a background job can give now that
  // there's no in-request event stream. `toolCallId` is the tool_use
  // block's own id (== the matching tool_result's `tool_use_id`), used to
  // find-and-update this exact item in place once its result arrives; see
  // `history.ts`'s `deriveToolResultUpdates`.
  | ({ id: string; kind: "step"; toolCallId: string } & ToolStep)
  // A centered, amber caption — connection errors, and turn_done reasons
  // that aren't a clean end_turn (budget / max_tools / error), plus "Stopped."
  // when the user aborts an in-flight turn (worklist items 4 + 8).
  | { id: string; kind: "system"; text: string };
