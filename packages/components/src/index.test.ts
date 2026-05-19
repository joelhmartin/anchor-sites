import { describe, expect, it } from "vitest";
import { VERSION, blockManifest, registerAll } from "./index.js";

describe("@anchorcorps/components entrypoint", () => {
  it("exports a VERSION string matching the 0.1.x major", () => {
    expect(VERSION).toMatch(/^0\.1\.\d+(-.*)?$/);
  });

  it("exports a blockManifest array (empty in the 0.1.0 skeleton)", () => {
    expect(Array.isArray(blockManifest)).toBe(true);
  });

  it("registerAll invokes the passed register fn once per manifest entry", () => {
    const calls: Array<{ type: string }> = [];
    registerAll((type) => {
      calls.push({ type });
    });
    expect(calls.length).toBe(blockManifest.length);
  });
});
