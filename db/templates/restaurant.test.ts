import { describe, expect, it } from "vitest";
// Side-effect: register the static block types so validateBlocks has a
// populated registry to check the authored blocks against (mirrors
// db/seed-templates.ts's import order).
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { restaurant } from "./restaurant.js";

describe("restaurant template seed", () => {
  it("every page's blocks validate against the block registry", () => {
    for (const page of restaurant.pages) {
      const failures = validateBlocks(page.blocks);
      expect(failures, `page "${page.slug}" had block failures: ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it("has unique page slugs", () => {
    const slugs = restaurant.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every page has a non-empty seo title and description", () => {
    for (const page of restaurant.pages) {
      const seo = page.seo as { title?: unknown; description?: unknown };
      expect(typeof seo.title, `page "${page.slug}" seo.title`).toBe("string");
      expect((seo.title as string).length, `page "${page.slug}" seo.title`).toBeGreaterThan(0);
      expect(typeof seo.description, `page "${page.slug}" seo.description`).toBe("string");
      expect((seo.description as string).length, `page "${page.slug}" seo.description`).toBeGreaterThan(0);
    }
  });

  it("seo titles stay under 60 chars and descriptions land in the 140-160 range", () => {
    for (const page of restaurant.pages) {
      const seo = page.seo as { title: string; description: string };
      expect(seo.title.length, `page "${page.slug}" title length`).toBeLessThanOrEqual(60);
      expect(seo.description.length, `page "${page.slug}" description length`).toBeGreaterThanOrEqual(140);
      expect(seo.description.length, `page "${page.slug}" description length`).toBeLessThanOrEqual(160);
    }
  });

  it("brand_tokens parse against the brand-token schema", () => {
    expect(() => brandTokensSchema.parse(restaurant.brand_tokens)).not.toThrow();
  });

  it("carries the expected gallery metadata", () => {
    expect(restaurant.slug).toBe("restaurant");
    expect(restaurant.category).toBe("Restaurant");
    expect(restaurant.sort_order).toBe(30);
    expect(restaurant.cover).toMatchObject({ stock_query: expect.any(String), alt: expect.any(String) });
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of restaurant.pages) {
      expect(page.blocks[0].type, `page "${page.slug}" first block`).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type, `page "${page.slug}" last block`).toBe("rich-footer");
    }
  });

  it("uses the registry's actual block type keys (phone_number / crm_form use underscores, not hyphens)", () => {
    const types = new Set(restaurant.pages.flatMap((p) => p.blocks.map((b) => b.type)));
    expect(types.has("phone-number")).toBe(false);
    expect(types.has("crm-form")).toBe(false);
    expect(types.has("phone_number")).toBe(true);
    expect(types.has("crm_form")).toBe(true);
  });
});
