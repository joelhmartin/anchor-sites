import { describe, expect, it } from "vitest";
import { fitnessStudio } from "./fitness-studio.js";
// Side-effect: register the static block types so validateBlocks below runs
// against a populated registry (same pattern db/seed-templates.ts relies on).
import "../../src/blocks/index.js";
import { validateBlocks } from "../../src/blocks/validate.js";
import { brandTokensSchema } from "../../src/blocks/brand-tokens.js";

describe("fitness-studio template", () => {
  it("has the expected gallery metadata", () => {
    expect(fitnessStudio.slug).toBe("fitness-studio");
    expect(fitnessStudio.category).toBe("Fitness");
    expect(fitnessStudio.sort_order).toBe(50);
    expect(fitnessStudio.name.length).toBeGreaterThan(0);
    expect(fitnessStudio.description.length).toBeGreaterThan(0);
  });

  it("every page's blocks validate against the live block registry", () => {
    for (const page of fitnessStudio.pages) {
      const failures = validateBlocks(page.blocks);
      expect(failures, `page "${page.slug}": ${JSON.stringify(failures)}`).toEqual([]);
    }
  });

  it("page slugs are unique", () => {
    const slugs = fitnessStudio.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("includes the required pages", () => {
    const slugs = fitnessStudio.pages.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["home", "classes", "trainers", "pricing", "contact"]));
  });

  it("every page has a non-empty seo title (<=60 chars) and description (140-160 chars)", () => {
    for (const page of fitnessStudio.pages) {
      const title = page.seo.title as string;
      const description = page.seo.description as string;
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(60);
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThanOrEqual(140);
      expect(description.length).toBeLessThanOrEqual(160);
    }
  });

  it("brand_tokens parse against the shared brand-token schema", () => {
    const result = brandTokensSchema.safeParse(fitnessStudio.brand_tokens);
    expect(result.success).toBe(true);
  });

  it("every page starts with nav-bar and ends with rich-footer", () => {
    for (const page of fitnessStudio.pages) {
      expect(page.blocks[0].type).toBe("nav-bar");
      expect(page.blocks[page.blocks.length - 1].type).toBe("rich-footer");
    }
  });

  it("block ids are unique within each page", () => {
    for (const page of fitnessStudio.pages) {
      const ids = page.blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
