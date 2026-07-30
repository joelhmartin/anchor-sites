import { describe, expect, it } from "vitest";
// Side-effect import: registers every block (package manifest + rich-text)
// against the registry so `validateBlocks` below has something to check
// against. See `src/blocks/index.ts`.
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { dentalPractice } from "./dental-practice.js";

describe("dental-practice template seed", () => {
  it("every page's blocks pass validateBlocks against the live registry", () => {
    for (const page of dentalPractice.pages) {
      const failures = validateBlocks(page.blocks);
      expect({ page: page.slug, failures }).toEqual({ page: page.slug, failures: [] });
    }
  });

  it("has unique page slugs", () => {
    const slugs = dentalPractice.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every page has a non-empty seo title and description", () => {
    for (const page of dentalPractice.pages) {
      const seo = page.seo as { title?: unknown; description?: unknown };
      expect(typeof seo.title).toBe("string");
      expect((seo.title as string).length).toBeGreaterThan(0);
      expect((seo.title as string).length).toBeLessThanOrEqual(60);

      expect(typeof seo.description).toBe("string");
      expect((seo.description as string).length).toBeGreaterThanOrEqual(140);
      expect((seo.description as string).length).toBeLessThanOrEqual(160);
    }
  });

  it("brand_tokens parse against the brand-token schema", () => {
    expect(brandTokensSchema.safeParse(dentalPractice.brand_tokens).success).toBe(true);
  });

  it("has the expected metadata", () => {
    expect(dentalPractice.slug).toBe("dental-practice");
    expect(dentalPractice.category).toBe("Medical");
    expect(dentalPractice.sort_order).toBe(10);
    expect(dentalPractice.cover).toMatchObject({ stock_query: expect.any(String), alt: expect.any(String) });
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of dentalPractice.pages) {
      expect(page.blocks[0].type).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type).toBe("rich-footer");
    }
  });

  it("has 5 pages: home, services, about, new-patients, contact", () => {
    expect(dentalPractice.pages.map((p) => p.slug)).toEqual([
      "home",
      "services",
      "about",
      "new-patients",
      "contact",
    ]);
  });
});
