import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
// Side-effect imports register each block in the registry.
import { heroSchema, Hero } from "./hero/index.js";
import { richTextSchema, RichText } from "./rich-text/index.js";
import { ctaSchema, Cta } from "./cta/index.js";
import { getBlock, listBlocks } from "./registry.js";

describe("static block side-effect registration", () => {
  it("hero, rich-text, and cta are all in the registry after import", () => {
    expect(getBlock("hero")?.label).toBe("Hero");
    expect(getBlock("rich-text")?.label).toBe("Rich text");
    expect(getBlock("cta")?.label).toBe("CTA banner");
    const types = listBlocks().map((r) => r.type).sort();
    // Subset check — registry.test.ts may have added test fixtures earlier in the file order.
    expect(types).toEqual(expect.arrayContaining(["cta", "hero", "rich-text"]));
  });
});

describe("block schemas", () => {
  describe("hero", () => {
    it("validates a valid props object", () => {
      const parsed = heroSchema.parse({ title: "Hello" });
      expect(parsed.title).toBe("Hello");
      expect(parsed.align).toBe("center"); // default
      expect(parsed.cta_label).toBe("Get started"); // default
    });

    it("fills defaults when given an empty object", () => {
      const parsed = heroSchema.parse({});
      expect(parsed.title).toBe("Headline goes here");
    });

    it("rejects invalid props", () => {
      expect(() => heroSchema.parse({ title: "" })).toThrow();
      expect(() => heroSchema.parse({ align: "diagonal" })).toThrow();
    });
  });

  describe("rich-text", () => {
    it("accepts an HTML string", () => {
      const parsed = richTextSchema.parse({ html: "<p>hi</p>" });
      expect(parsed.html).toBe("<p>hi</p>");
      expect(parsed.max_width).toBe("medium"); // default
    });

    it("rejects an invalid max_width", () => {
      expect(() => richTextSchema.parse({ max_width: "huge" })).toThrow();
    });
  });

  describe("cta", () => {
    it("validates and applies defaults", () => {
      const parsed = ctaSchema.parse({ heading: "Hey" });
      expect(parsed.heading).toBe("Hey");
      expect(parsed.button_label).toBe("Contact us");
      expect(parsed.variant).toBe("primary");
    });

    it("rejects empty heading", () => {
      expect(() => ctaSchema.parse({ heading: "" })).toThrow();
    });

    it("rejects unknown variant", () => {
      expect(() => ctaSchema.parse({ variant: "danger" })).toThrow();
    });
  });
});

describe("block components render via SSR", () => {
  it("Hero renders with ac- classes and the title", () => {
    const html = renderToString(createElement(Hero, heroSchema.parse({ title: "Hi" })));
    expect(html).toContain("ac-hero");
    expect(html).toContain("ac-hero__title");
    expect(html).toContain("Hi");
  });

  it("RichText renders dangerouslySetInnerHTML content", () => {
    const html = renderToString(
      createElement(RichText, richTextSchema.parse({ html: "<p>body</p>" })),
    );
    expect(html).toContain("ac-rich-text");
    expect(html).toContain("<p>body</p>");
  });

  it("Cta renders heading and button", () => {
    const html = renderToString(
      createElement(
        Cta,
        ctaSchema.parse({ heading: "Hey", button_label: "Go", button_href: "/x" }),
      ),
    );
    expect(html).toContain("ac-cta");
    expect(html).toContain("Hey");
    expect(html).toContain("Go");
    expect(html).toContain('href="/x"');
  });

  it("rendered Hero never contains a font-family declaration", () => {
    const html = renderToString(createElement(Hero, heroSchema.parse({ title: "x" })));
    // Components must not emit inline font-family per architectural anchor #8.
    expect(html).not.toMatch(/font-family\s*:/i);
  });
});
