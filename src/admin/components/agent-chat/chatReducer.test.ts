import { describe, expect, it } from "vitest";
import { friendlyToolLabel } from "./chatReducer.js";

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
