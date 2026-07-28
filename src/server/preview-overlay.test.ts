import { describe, it, expect } from "vitest";
import { getOverlayJs, makeNonce, __resetOverlayCacheForTests, OVERLAY_CSS } from "./preview-overlay.js";
import {
  IMAGE_CHIP_CLASS,
  IMAGE_CHIP_VISIBLE_CLASS,
} from "../editor-overlay/images.js";
import { LINK_CHIP_CLASS, LINK_CHIP_VISIBLE_CLASS } from "../editor-overlay/links.js";
import {
  RT_TOOLBAR_CLASS,
  RT_TOOLBAR_VISIBLE_CLASS,
  RT_LINK_ROW_CLASS,
  RT_LINK_ROW_VISIBLE_CLASS,
} from "../editor-overlay/rich-text.js";

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

  // Important 2 (final review): images.ts/links.ts/rich-text.ts define and
  // toggle these classes at runtime, but OVERLAY_CSS had NO rules for any
  // of them — the image-swap chip, link-edit chip, and rich-text mini
  // toolbar/link-row were all invisible (or, worse, visible-but-unstyled)
  // in a real preview. This is a string-level presence check only — actual
  // visual QA (positioning, contrast, etc.) is operator-run per this
  // repo's convention, not something a unit test can verify against a real
  // rendered iframe.
  it("OVERLAY_CSS has a rule for every image-chip / link-chip / rich-text-toolbar class the overlay modules define", () => {
    const classNames = [
      IMAGE_CHIP_CLASS,
      IMAGE_CHIP_VISIBLE_CLASS,
      LINK_CHIP_CLASS,
      LINK_CHIP_VISIBLE_CLASS,
      RT_TOOLBAR_CLASS,
      RT_TOOLBAR_VISIBLE_CLASS,
      RT_LINK_ROW_CLASS,
      RT_LINK_ROW_VISIBLE_CLASS,
    ];
    for (const cls of classNames) {
      expect(OVERLAY_CSS).toContain(`.${cls}`);
    }
  });
});
