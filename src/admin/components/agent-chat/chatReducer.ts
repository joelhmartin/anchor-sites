// src/admin/components/agent-chat/chatReducer.ts
//
// The Studio chat drawer's turn state machine — pure, React-free, ported from
// anchor-operations' copilot (`copilot/chatReducer.js`). A "turn" is the
// agent working one prompt: while it streams we accumulate the coalesced
// assistant text and the tool steps (spinner → check); the moment it goes
// final everything folds into a single assistant bubble with a collapsed
// "Worked through N steps · Xs" disclosure.
//
// Unlike the ops version, our SSE stream has no separate `thinking`/`text`
// delta granularity and no distinct pre-tool "interim narration" — Task 10's
// agent loop emits one `assistant_text` per completed text block. So this
// reducer is simpler: it just coalesces consecutive `assistant_text` events
// into one running string and tracks tool_call → tool_result pairs.

import type { AgentTurnEvent } from "../../lib/agent-api.js";

export type ToolStepState = "running" | "done";

export type ToolStep = {
  name: string;
  label: string;
  state: ToolStepState;
};

export type TurnState = {
  text: string; // all coalesced assistant_text for this turn so far
  toolSteps: ToolStep[];
  startedAt: number;
};

export type FinalizedTurn = {
  text: string;
  toolSteps: ToolStep[];
  stepCount: number;
  seconds: number;
};

// Friendly, human labels for each tool the agent can call. Unknown tools fall
// back to a title-cased version of the raw name so a new tool still reads okay.
const TOOL_LABELS: Record<string, string> = {
  get_site_overview: "Reviewing the site",
  get_page: "Reading a page",
  create_page: "Creating a page",
  update_page: "Editing a page",
  delete_page: "Removing a page",
  set_brand_tokens: "Updating brand colors",
  set_seo_defaults: "Updating SEO settings",
  set_page_seo: "Updating page SEO",
  list_templates: "Browsing templates",
  apply_site_template: "Applying a template",
  search_stock_images: "Searching stock photos",
  import_image: "Importing an image",
  list_media: "Checking the media library",
};

export function friendlyToolLabel(name: string | undefined | null): string {
  if (name && TOOL_LABELS[name]) return TOOL_LABELS[name];
  return String(name || "Working")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function initialTurnState(): TurnState {
  return { text: "", toolSteps: [], startedAt: Date.now() };
}

/**
 * Applies one live `assistant_text` / `tool_call` / `tool_result` event to
 * the running turn state. `turn_done` is NOT handled here — the drawer calls
 * `finalizeTurn` directly so it can also branch on `reason` (promoted / error
 * / budget / max_tools) for behavior this pure reducer doesn't own.
 */
export function applyTurnEvent(state: TurnState, event: AgentTurnEvent): TurnState {
  switch (event.type) {
    case "assistant_text": {
      if (!event.text) return state;
      // Coalesce consecutive assistant_text events into ONE running string
      // (worklist item 6) rather than a new bubble per event.
      return { ...state, text: state.text + event.text };
    }
    case "tool_call": {
      const step: ToolStep = { name: event.name, label: friendlyToolLabel(event.name), state: "running" };
      return { ...state, toolSteps: [...state.toolSteps, step] };
    }
    case "tool_result": {
      const steps = state.toolSteps.slice();
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (steps[i].state === "running" && steps[i].name === event.name) {
          steps[i] = { ...steps[i], state: "done" };
          break;
        }
      }
      return { ...state, toolSteps: steps };
    }
    default:
      return state;
  }
}

/** Folds a completed turn's live state into what the finalized bubble needs. */
export function finalizeTurn(state: TurnState): FinalizedTurn {
  const seconds = Math.max(1, Math.round((Date.now() - (state.startedAt || Date.now())) / 1000));
  return {
    text: state.text,
    toolSteps: state.toolSteps.map((step) => (step.state === "running" ? { ...step, state: "done" as const } : step)),
    stepCount: state.toolSteps.length,
    seconds,
  };
}

/** Default, friendly copy for a `turn_done` reason that isn't a clean end_turn. */
export function turnDoneMessage(reason: string, message?: string): string {
  if (message) return message;
  if (reason === "budget") return "Paused — this turn hit its budget.";
  if (reason === "max_tools") return "Paused — reached the tool-call limit for this turn.";
  if (reason === "error") return "Something went wrong.";
  return "";
}
