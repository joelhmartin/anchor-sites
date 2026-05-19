import { describe, expect, it } from "vitest";
import { VERSION, blockManifest, registerAll } from "./index.js";

describe("@anchorcorps/components entrypoint", () => {
  it("exports a VERSION string matching the 0.x series", () => {
    expect(VERSION).toMatch(/^0\.\d+\.\d+(-.*)?$/);
  });

  it("exports a blockManifest array (populated in 0.2.0)", () => {
    expect(Array.isArray(blockManifest)).toBe(true);
    expect(blockManifest.length).toBeGreaterThan(0);
  });

  it("registerAll invokes the passed register fn once per manifest entry", () => {
    const calls: Array<{ type: string }> = [];
    registerAll((type) => {
      calls.push({ type });
    });
    expect(calls.length).toBe(blockManifest.length);
  });
});
