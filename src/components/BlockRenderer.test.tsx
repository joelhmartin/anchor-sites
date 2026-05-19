import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { BlockRenderer } from "./BlockRenderer.js";
// Side-effect: register hero/rich-text/cta.
import "../blocks/index.js";
import type { Block } from "../blocks/types.js";

describe("BlockRenderer", () => {
  it("renders nothing for an empty array", () => {
    const html = renderToString(createElement(BlockRenderer, { blocks: [] }));
    expect(html).toBe("");
  });

  it("renders unknown block types via <UnknownBlock> without crashing", () => {
    const blocks: Block[] = [{ id: "u1", type: "nope-not-real", props: {} }];
    const html = renderToString(createElement(BlockRenderer, { blocks }));
    expect(html).toContain("data-block-unknown=\"nope-not-real\"");
    expect(html).toContain("Unknown block type");
  });

  it("renders invalid props via <BlockError> without crashing", () => {
    const blocks: Block[] = [
      // hero requires title.min(1); empty string should fail validation
      { id: "e1", type: "hero", props: { title: "" } },
    ];
    const html = renderToString(createElement(BlockRenderer, { blocks }));
    expect(html).toContain("data-block-error=\"hero\"");
    expect(html).toContain("Block error: hero");
  });

  it("renders three known blocks in order with correct keys when editable", () => {
    const blocks: Block[] = [
      { id: "a", type: "hero", props: { title: "A" } },
      { id: "b", type: "rich-text", props: { html: "<p>B</p>" } },
      { id: "c", type: "cta", props: { heading: "C", button_label: "go", button_href: "/x" } },
    ];
    const html = renderToString(createElement(BlockRenderer, { blocks, editable: true }));
    // data-block-id and data-block-type wrap each rendered block in editable mode
    expect(html).toContain('data-block-id="a"');
    expect(html).toContain('data-block-id="b"');
    expect(html).toContain('data-block-id="c"');
    expect(html).toContain('data-block-type="hero"');
    expect(html).toContain('data-block-type="rich-text"');
    expect(html).toContain('data-block-type="cta"');
    // Order check: A must appear before B which must appear before C
    const ia = html.indexOf('data-block-id="a"');
    const ib = html.indexOf('data-block-id="b"');
    const ic = html.indexOf('data-block-id="c"');
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(ic);
  });

  it("non-editable mode omits the data-block-* wrapper", () => {
    const blocks: Block[] = [{ id: "x", type: "hero", props: { title: "X" } }];
    const html = renderToString(createElement(BlockRenderer, { blocks, editable: false }));
    expect(html).not.toContain('data-block-id="x"');
    // But the hero content still renders
    expect(html).toContain("ac-hero");
    expect(html).toContain("X");
  });

  it("BlockError is silent (no visible markup) when NODE_ENV=production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const blocks: Block[] = [{ id: "e", type: "hero", props: { title: "" } }];
      const html = renderToString(createElement(BlockRenderer, { blocks }));
      expect(html).not.toContain("Block error:");
      expect(html).toContain("aria-hidden=\"true\"");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
