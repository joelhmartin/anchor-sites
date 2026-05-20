// @vitest-environment jsdom
import "./puck-jsdom.js"; // must precede the Puck import — installs ResizeObserver
import { describe, expect, it } from "vitest";
import puckPkg from "@measured/puck/package.json";
import { Puck, PUCK_VERSION } from "../index.js";

describe("editor barrel (P5-T5.1)", () => {
  it("loads Puck in jsdom and re-exports the editor component", () => {
    // Importing the barrel evaluates @measured/puck in a DOM environment;
    // if Puck had top-level code that crashed in jsdom this would throw.
    expect(Puck).toBeTypeOf("function");
  });

  it("pins a Puck version that matches the installed package (no drift)", () => {
    expect(PUCK_VERSION).toBe(puckPkg.version);
  });
});
