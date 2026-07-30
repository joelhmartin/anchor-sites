import { describe, it, expect } from "vitest";
// Register the static block types so the registry-backed validator works.
import "../../blocks/index.js";
import {
  validateTemplatePages,
  createTemplateInputSchema,
  templateKindSchema,
} from "./schema.js";

describe("template schema (P7-T7.2)", () => {
  it("validateTemplatePages returns [] when every page's blocks are valid", () => {
    const failures = validateTemplatePages([
      { slug: "home", blocks: [{ id: "r1", type: "rich-text", props: { html: "<p>ok</p>" } }] },
      { slug: "empty", blocks: [] },
    ]);
    expect(failures).toEqual([]);
  });

  it("validateTemplatePages flags unknown types and bad props per page", () => {
    const failures = validateTemplatePages([
      { slug: "good", blocks: [{ id: "r1", type: "rich-text", props: { html: "<p>ok</p>" } }] },
      { slug: "unknown", blocks: [{ id: "x", type: "nope", props: {} }] },
      { slug: "badprops", blocks: [{ id: "h", type: "rich-text", props: { max_width: "huge" } }] },
    ]);
    expect(failures.map((f) => f.page_slug).sort()).toEqual(["badprops", "unknown"]);
    expect(failures.find((f) => f.page_slug === "unknown")!.failures[0].reason).toBe("unknown_type");
    expect(failures.find((f) => f.page_slug === "badprops")!.failures[0].reason).toBe("invalid_props");
  });

  it("createTemplateInputSchema defaults kind=site, pages=[], and rejects bad slugs", () => {
    const parsed = createTemplateInputSchema.parse({ slug: "starter", name: "Starter" });
    expect(parsed.kind).toBe("site");
    expect(parsed.pages).toEqual([]);
    expect(parsed.sort_order).toBe(0);
    expect(parsed.category).toBeUndefined();
    expect(parsed.cover_image_url).toBeUndefined();

    expect(() => createTemplateInputSchema.parse({ slug: "Bad Slug", name: "x" })).toThrow();
    expect(() => createTemplateInputSchema.parse({ slug: "-lead", name: "x" })).toThrow();
  });

  it("templateKindSchema accepts site/page and rejects others", () => {
    expect(templateKindSchema.parse("site")).toBe("site");
    expect(templateKindSchema.parse("page")).toBe("page");
    expect(() => templateKindSchema.parse("widget")).toThrow();
  });
});
