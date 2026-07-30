import { describe, expect, it } from "vitest";
// Side-effect: register the static + package block types so validateBlocks
// runs against the same registry the save/materialize paths use.
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { homeServices } from "./home-services.js";

describe("home-services template (Task C5-C14)", () => {
  it("every page's blocks pass validateBlocks against the live registry", () => {
    for (const page of homeServices.pages) {
      const failures = validateBlocks(page.blocks);
      expect(failures, `page "${page.slug}" had invalid blocks: ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it("has the 5 expected pages with unique slugs", () => {
    const slugs = homeServices.pages.map((p) => p.slug);
    expect(slugs).toEqual(["home", "services", "service-area", "reviews", "contact"]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every page has a non-empty seo title (<=60 chars) and description (140-160 chars)", () => {
    for (const page of homeServices.pages) {
      const seo = page.seo as { title?: string; description?: string };
      expect(seo.title, `page "${page.slug}" missing seo.title`).toBeTruthy();
      expect(seo.description, `page "${page.slug}" missing seo.description`).toBeTruthy();
      expect(seo.title!.length, `page "${page.slug}" seo.title too long`).toBeLessThanOrEqual(60);
      expect(seo.description!.length, `page "${page.slug}" seo.description length`).toBeGreaterThanOrEqual(140);
      expect(seo.description!.length, `page "${page.slug}" seo.description length`).toBeLessThanOrEqual(160);
    }
  });

  it("every block id is unique across the whole template", () => {
    const ids = homeServices.pages.flatMap((p) => p.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of homeServices.pages) {
      expect(page.blocks[0].type, `page "${page.slug}" first block`).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type, `page "${page.slug}" last block`).toBe("rich-footer");
    }
  });

  it("brand_tokens parse against the shared brand-token schema", () => {
    expect(() => brandTokensSchema.parse(homeServices.brand_tokens)).not.toThrow();
  });

  it("has gallery metadata matching the assigned category and sort order", () => {
    expect(homeServices.slug).toBe("home-services");
    expect(homeServices.category).toBe("Home Services");
    expect(homeServices.sort_order).toBe(20);
    expect(homeServices.cover).toMatchObject({ stock_query: expect.any(String), alt: expect.any(String) });
  });
});
