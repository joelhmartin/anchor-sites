import { describe, expect, it } from "vitest";
import {
  applyTurnEvent,
  finalizeTurn,
  friendlyToolLabel,
  initialTurnState,
  turnDoneMessage,
} from "./chatReducer.js";

describe("friendlyToolLabel", () => {
  it("maps known tool names to friendly labels", () => {
    expect(friendlyToolLabel("get_site_overview")).toBe("Reviewing the site");
    expect(friendlyToolLabel("update_page")).toBe("Editing a page");
    expect(friendlyToolLabel("apply_site_template")).toBe("Applying a template");
  });

  it("title-cases unknown tool names as a fallback", () => {
    expect(friendlyToolLabel("some_new_tool")).toBe("Some New Tool");
  });

  it("falls back to 'Working' for a missing name", () => {
    expect(friendlyToolLabel(undefined)).toBe("Working");
  });
});

describe("applyTurnEvent", () => {
  it("coalesces consecutive assistant_text events into one running string", () => {
    let state = initialTurnState();
    state = applyTurnEvent(state, { type: "assistant_text", text: "Hello, " });
    state = applyTurnEvent(state, { type: "assistant_text", text: "world." });
    expect(state.text).toBe("Hello, world.");
  });

  it("adds a running tool step on tool_call", () => {
    let state = initialTurnState();
    state = applyTurnEvent(state, { type: "tool_call", name: "update_page", input: {} });
    expect(state.toolSteps).toEqual([{ name: "update_page", label: "Editing a page", state: "running" }]);
  });

  it("marks the matching running step done on tool_result", () => {
    let state = initialTurnState();
    state = applyTurnEvent(state, { type: "tool_call", name: "update_page", input: {} });
    state = applyTurnEvent(state, { type: "tool_result", name: "update_page", ok: true });
    expect(state.toolSteps[0].state).toBe("done");
  });

  it("matches the most recent running step by name (two calls to the same tool)", () => {
    let state = initialTurnState();
    state = applyTurnEvent(state, { type: "tool_call", name: "get_page", input: {} });
    state = applyTurnEvent(state, { type: "tool_call", name: "get_page", input: {} });
    state = applyTurnEvent(state, { type: "tool_result", name: "get_page", ok: true });
    expect(state.toolSteps.map((s) => s.state)).toEqual(["running", "done"]);
  });
});

describe("finalizeTurn", () => {
  it("counts steps and force-completes any still-running step", () => {
    let state = initialTurnState();
    state = applyTurnEvent(state, { type: "assistant_text", text: "Working…" });
    state = applyTurnEvent(state, { type: "tool_call", name: "get_page", input: {} });
    const final = finalizeTurn(state);
    expect(final.text).toBe("Working…");
    expect(final.stepCount).toBe(1);
    expect(final.toolSteps[0].state).toBe("done");
    expect(final.seconds).toBeGreaterThanOrEqual(1);
  });
});

describe("turnDoneMessage", () => {
  it("prefers an explicit message over the default", () => {
    expect(turnDoneMessage("budget", "Custom budget note")).toBe("Custom budget note");
  });

  it("has friendly defaults for budget, max_tools, and error", () => {
    expect(turnDoneMessage("budget")).toMatch(/budget/i);
    expect(turnDoneMessage("max_tools")).toMatch(/tool-call limit/i);
    expect(turnDoneMessage("error")).toMatch(/wrong/i);
  });

  it("is empty for end_turn / promoted (no system line needed)", () => {
    expect(turnDoneMessage("end_turn")).toBe("");
    expect(turnDoneMessage("promoted")).toBe("");
  });
});
