import { describe, expect, it } from "vitest";
// Side-effect import: registers every block (package manifest + rich-text)
// against the registry so `validateBlocks` below has something to check
// against. See `src/blocks/index.ts`.
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";
import { creativePortfolio } from "./creative-portfolio.js";

describe("creative-portfolio template seed", () => {
  it("every page's blocks pass validateBlocks against the live registry", () => {
    for (const page of creativePortfolio.pages) {
      const failures = validateBlocks(page.blocks);
      expect({ page: page.slug, failures }).toEqual({ page: page.slug, failures: [] });
    }
  });

  it("has unique page slugs", () => {
    const slugs = creativePortfolio.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every page has a non-empty seo title and description", () => {
    for (const page of creativePortfolio.pages) {
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
    expect(brandTokensSchema.safeParse(creativePortfolio.brand_tokens).success).toBe(true);
  });

  it("has the expected metadata", () => {
    expect(creativePortfolio.slug).toBe("creative-portfolio");
    expect(creativePortfolio.category).toBe("Portfolio");
    expect(creativePortfolio.sort_order).toBe(60);
    expect(creativePortfolio.cover).toMatchObject({ stock_query: expect.any(String), alt: expect.any(String) });
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of creativePortfolio.pages) {
      expect(page.blocks[0].type).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type).toBe("rich-footer");
    }
  });

  it("has 4 pages: home, work, about, contact", () => {
    expect(creativePortfolio.pages.map((p) => p.slug)).toEqual(["home", "work", "about", "contact"]);
  });

  it("uses the registry's actual block type keys (phone_number / crm_form use underscores, not hyphens)", () => {
    const types = new Set(creativePortfolio.pages.flatMap((p) => p.blocks.map((b) => b.type)));
    expect(types.has("phone-number")).toBe(false);
    expect(types.has("crm-form")).toBe(false);
    expect(types.has("phone_number")).toBe(true);
    expect(types.has("crm_form")).toBe(true);
  });
});
