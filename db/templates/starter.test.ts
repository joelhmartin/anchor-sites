import { describe, expect, it } from "vitest";
// Side-effect: register the static + package block types so validateBlocks
// runs against the same registry the save/materialize paths use.
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { starter } from "./starter.js";

describe("starter template seed (W1.6 — D706/D717)", () => {
  it("every page's blocks validate against the block registry", () => {
    for (const page of starter.pages) {
      const failures = validateBlocks(page.blocks);
      expect(failures, `page "${page.slug}" had block failures: ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it("has the expected pages with unique slugs", () => {
    const slugs = starter.pages.map((p) => p.slug);
    expect(slugs).toEqual(["home", "about"]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every block id is unique across the whole template", () => {
    const ids = starter.pages.flatMap((p) => p.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("brand_tokens parse against the brand-token schema", () => {
    expect(() => brandTokensSchema.parse(starter.brand_tokens)).not.toThrow();
  });

  it("carries the expected gallery metadata", () => {
    expect(starter.slug).toBe("starter");
    expect(starter.category).toBe("Basic");
    expect(starter.sort_order).toBe(999);
  });

  it("D706: the home hero CTA anchors to a block that exists on the home page", () => {
    const home = starter.pages.find((p) => p.slug === "home")!;
    const hero = home.blocks.find((b) => b.id === "starter-home-hero")!;
    const href = (hero.props as { cta_href: string }).cta_href;
    expect(href.startsWith("#")).toBe(true);
    expect(home.blocks.map((b) => b.id)).toContain(href.slice(1));
  });
});
