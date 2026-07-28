import { describe, it, expect } from "vitest";
import { getOverlayJs, makeNonce, __resetOverlayCacheForTests } from "./preview-overlay.js";

describe("preview overlay compiler", () => {
  it("compiles the overlay entry to a self-contained IIFE containing the boot marker", () => {
    __resetOverlayCacheForTests();
    const js = getOverlayJs();
    expect(js).toContain("__AC_EDIT_OVERLAY__");   // marker constant in main.ts
    expect(js).not.toContain("import ");            // bundled, no bare imports
  });
  it("caches between calls", () => {
    __resetOverlayCacheForTests();
    expect(getOverlayJs()).toBe(getOverlayJs());    // same string identity
  });
  it("makeNonce returns distinct url-safe values", () => {
    const a = makeNonce(); const b = makeNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });
});
