import { describe, expect, it } from "vitest";
// Side-effect: register the static + package block types so validateBlocks
// runs against the same registry the save/materialize paths use.
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { coaching } from "./coaching.js";

describe("coaching template (Task C5-C14)", () => {
  it("every page's blocks pass validateBlocks against the live registry", () => {
    for (const page of coaching.pages) {
      const failures = validateBlocks(page.blocks);
      expect(failures, `page "${page.slug}" had invalid blocks: ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it("has the 4 expected pages with unique slugs", () => {
    const slugs = coaching.pages.map((p) => p.slug);
    expect(slugs).toEqual(["home", "programs", "about", "book-a-call"]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every page has a non-empty seo title (<=60 chars) and description (140-160 chars)", () => {
    for (const page of coaching.pages) {
      const seo = page.seo as { title?: string; description?: string };
      expect(seo.title, `page "${page.slug}" missing seo.title`).toBeTruthy();
      expect(seo.description, `page "${page.slug}" missing seo.description`).toBeTruthy();
      expect(seo.title!.length, `page "${page.slug}" seo.title too long`).toBeLessThanOrEqual(60);
      expect(seo.description!.length, `page "${page.slug}" seo.description length`).toBeGreaterThanOrEqual(140);
      expect(seo.description!.length, `page "${page.slug}" seo.description length`).toBeLessThanOrEqual(160);
    }
  });

  it("every block id is unique across the whole template", () => {
    const ids = coaching.pages.flatMap((p) => p.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of coaching.pages) {
      expect(page.blocks[0].type, `page "${page.slug}" first block`).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type, `page "${page.slug}" last block`).toBe("rich-footer");
    }
  });

  it("every page has exactly one <h1>-owning block (hero/split-hero/hero-slider)", () => {
    for (const page of coaching.pages) {
      const heroLikeBlocks = page.blocks.filter((b) => b.type === "hero" || b.type === "split-hero" || b.type === "hero-slider");
      expect(heroLikeBlocks.length, `page "${page.slug}" should have exactly one <h1>-owning block`).toBe(1);
    }
  });

  it("brand_tokens parse against the shared brand-token schema", () => {
    expect(() => brandTokensSchema.parse(coaching.brand_tokens)).not.toThrow();
  });

  it("has gallery metadata matching the assigned category and sort order", () => {
    expect(coaching.slug).toBe("coaching");
    expect(coaching.category).toBe("Coaching");
    expect(coaching.sort_order).toBe(70);
    expect(coaching.cover).toMatchObject({ stock_query: expect.any(String), alt: expect.any(String) });
  });

  it("the book-a-call page pairs a low-friction crm_form with a what-to-expect FAQ", () => {
    const bookACall = coaching.pages.find((p) => p.slug === "book-a-call")!;
    const types = bookACall.blocks.map((b) => b.type);
    expect(types).toContain("crm_form");
    expect(types).toContain("faq-accordion");
  });

  it("the programs page lays out 1:1, group, and intensive offerings with pricing", () => {
    const programs = coaching.pages.find((p) => p.slug === "programs")!;
    const html = programs.blocks
      .filter((b) => b.type === "rich-text")
      .map((b) => (b.props as { html: string }).html)
      .join(" ");
    expect(html).toContain("1:1 Coaching");
    expect(html).toContain("Group Coaching");
    expect(html).toContain("Two-Day Intensive");
    expect(html).toMatch(/\$\d/);
  });
});
