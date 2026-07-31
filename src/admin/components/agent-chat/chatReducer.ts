// src/admin/components/agent-chat/chatReducer.ts
//
// Shared display helpers for the Studio chat transcript. This used to also
// hold a live "turn" state machine (`applyTurnEvent`/`finalizeTurn`/
// `turnDoneMessage`/`initialTurnState`/`TurnState`/`FinalizedTurn`) for the
// old `AgentChatDrawer` component, which streamed one turn's events inline
// over an in-request HTTP response. Task A2 (2026-07-30 lovable-workspace
// SDD) deleted that inline turn path — every chat turn now runs as a
// background pg-boss job and the client only ever tails persisted
// `ai_messages` rows via `GET .../events`, so `AgentChatDrawer` and that
// turn-state machinery were dead code and have been deleted. What's left
// here — `friendlyToolLabel` and the `ToolStep`/`ToolStepState` types — is
// still live: `history.ts` (`deriveToolResultUpdates`) and `types.ts` use it
// to render tool-call rows in the persisted-message transcript.

// "error" lets a tailed tool_result with `is_error:true`
// (history.ts's `deriveToolResultUpdates`) render distinctly from a clean
// success, since these rows are permanent, always-visible transcript steps.
export type ToolStepState = "running" | "done" | "error";

export type ToolStep = {
  name: string;
  label: string;
  state: ToolStepState;
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
