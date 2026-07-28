import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

// Importing `./index.js` registers the package blocks + the inline
// rich-text block against the renderer's registry via side effects.
import "./index.js";
import { richTextSchema, RichText } from "./rich-text/index.js";
import { getBlock, listBlocks } from "./registry.js";

describe("block registration after src/blocks/index.ts loads", () => {
  it("registers the Phase 1 ports from the package", () => {
    // Schema parity — these come from @anchorcorps/components now.
    expect(getBlock("hero")?.label).toBe("Hero");
    expect(getBlock("cta")?.label).toBe("Call to action");
  });

  it("registers the new blocks shipped by the package (v0.1)", () => {
    expect(getBlock("hero-slider")?.category).toBe("header");
    expect(getBlock("testimonial-carousel")?.category).toBe("content");
    expect(getBlock("logo-reel")?.category).toBe("content");
    expect(getBlock("faq-accordion")?.category).toBe("content");
  });

  it("registers the inline rich-text block (kept inline pending Phase 5 Tiptap)", () => {
    expect(getBlock("rich-text")?.label).toBe("Rich text");
  });

  it("listBlocks contains every expected type", () => {
    const types = listBlocks().map((r) => r.type).sort();
    expect(types).toEqual(
      expect.arrayContaining([
        "cta",
        "faq-accordion",
        "hero",
        "hero-slider",
        "logo-reel",
        "rich-text",
        "testimonial-carousel",
      ]),
    );
  });
});

describe("inline rich-text block", () => {
  it("accepts an HTML string", () => {
    const parsed = richTextSchema.parse({ html: "<p>hi</p>" });
    expect(parsed.html).toBe("<p>hi</p>");
    expect(parsed.max_width).toBe("medium");
  });

  it("rejects an invalid max_width", () => {
    expect(() => richTextSchema.parse({ max_width: "huge" })).toThrow();
  });

  it("renders dangerouslySetInnerHTML content via SSR", () => {
    const html = renderToString(
      createElement(RichText, richTextSchema.parse({ html: "<p>body</p>" })),
    );
    expect(html).toContain("ac-rich-text");
    expect(html).toContain("<p>body</p>");
  });

  it("marks the inner div with data-field=\"html\" for inline editing", () => {
    const html = renderToString(
      createElement(RichText, richTextSchema.parse({ html: "<p>body</p>" })),
    );
    expect(html).toContain('data-field="html"');
  });
});

describe("architectural anchors via SSR on a registered hero block", () => {
  it("rendered hero never emits an inline font-family declaration (D-005)", () => {
    const entry = getBlock("hero");
    if (!entry) throw new Error("hero not registered");
    const html = renderToString(
      createElement(entry.component, entry.schema.parse({ title: "x" })),
    );
    expect(html).not.toMatch(/font-family\s*:/i);
  });

  it("rendered hero carries the ac-hero root class", () => {
    const entry = getBlock("hero");
    if (!entry) throw new Error("hero not registered");
    const html = renderToString(
      createElement(entry.component, entry.schema.parse({ title: "x" })),
    );
    expect(html).toContain("ac-hero");
  });
});
