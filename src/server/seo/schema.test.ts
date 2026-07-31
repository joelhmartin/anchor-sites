import { describe, expect, it } from "vitest";
import {
  applyTitleTemplate,
  defaultTitleTemplate,
  effectiveRobots,
  normalizeTwitterHandle,
  parseSeoLoose,
  parseSiteSeoDefaultsLoose,
  seoFieldsSchema,
  siteSeoDefaultsSchema,
} from "./schema.js";

describe("seoFieldsSchema (P9-T9.1, D-049)", () => {
  it("accepts an empty object (no SEO set)", () => {
    expect(seoFieldsSchema.parse({})).toEqual({});
  });

  it("accepts the legacy {title, description} shape unchanged", () => {
    const seo = { title: "Home", description: "Welcome" };
    expect(seoFieldsSchema.parse(seo)).toEqual(seo);
  });

  it("strips unknown keys rather than throwing", () => {
    const parsed = seoFieldsSchema.parse({ title: "X", legacyJunk: 1, foo: "bar" });
    expect(parsed).toEqual({ title: "X" });
  });

  it("validates the full field set (canonical, robots, og, twitter)", () => {
    const seo = {
      title: "T",
      description: "D",
      canonical: "https://acme.sites.anchorcorps.com/",
      robots: { index: false, follow: true },
      og: { title: "OG", imageAssetId: "11111111-1111-1111-1111-111111111111" },
      twitter: { card: "summary_large_image" as const },
    };
    expect(seoFieldsSchema.parse(seo)).toEqual(seo);
  });

  it("is field-tolerant: drops an invalid field, keeps the valid ones, never throws", () => {
    // one bad field must NOT discard the whole blob (a noindex page that also
    // has a dirty canonical must keep its robots directive)
    expect(
      seoFieldsSchema.parse({
        canonical: "not a url",
        robots: { index: false, follow: true },
        title: "Keep me",
      }),
    ).toEqual({ title: "Keep me", robots: { index: false, follow: true } });
  });

  it("drops a non-url canonical rather than failing", () => {
    const r = seoFieldsSchema.safeParse({ canonical: "not a url" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({});
  });

  it("drops a non-uuid og image asset id but keeps a valid og title", () => {
    expect(seoFieldsSchema.parse({ og: { imageAssetId: "nope", title: "OG" } })).toEqual({
      og: { title: "OG" },
    });
  });

  it("drops an unknown twitter card type rather than failing", () => {
    expect(seoFieldsSchema.safeParse({ twitter: { card: "player" } }).success).toBe(true);
  });
});

describe("parseSeoLoose", () => {
  it("returns {} for null/undefined/non-object", () => {
    expect(parseSeoLoose(null)).toEqual({});
    expect(parseSeoLoose(undefined)).toEqual({});
    expect(parseSeoLoose("garbage")).toEqual({});
  });

  it("returns {} (never throws) on a structurally invalid blob", () => {
    expect(parseSeoLoose({ canonical: "not a url" })).toEqual({});
  });

  it("parses a valid blob", () => {
    expect(parseSeoLoose({ title: "X" })).toEqual({ title: "X" });
  });
});

describe("effectiveRobots", () => {
  it("defaults to index+follow when unset", () => {
    expect(effectiveRobots({})).toEqual({ index: true, follow: true });
  });

  it("honors explicit directives", () => {
    expect(effectiveRobots({ robots: { index: false, follow: false } })).toEqual({
      index: false,
      follow: false,
    });
  });
});

describe("siteSeoDefaultsSchema (P9-T9.3)", () => {
  it("accepts an empty object", () => {
    expect(siteSeoDefaultsSchema.parse({})).toEqual({});
  });

  it("accepts the full default set", () => {
    const d = {
      titleTemplate: "%s — Acme",
      defaultDescription: "default",
      defaultOgImageAssetId: "11111111-1111-1111-1111-111111111111",
      twitterHandle: "@acme",
    };
    expect(siteSeoDefaultsSchema.parse(d)).toEqual(d);
  });

  it("accepts a twitter handle without @", () => {
    expect(siteSeoDefaultsSchema.safeParse({ twitterHandle: "acme" }).success).toBe(true);
  });

  it("drops an over-long twitter handle rather than failing the blob", () => {
    const r = siteSeoDefaultsSchema.safeParse({
      titleTemplate: "%s — Acme",
      twitterHandle: "waytoolongforatwitterhandle",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ titleTemplate: "%s — Acme" });
  });

  it("parseSiteSeoDefaultsLoose returns {} on garbage, never throws", () => {
    expect(parseSiteSeoDefaultsLoose(null)).toEqual({});
    expect(parseSiteSeoDefaultsLoose({ defaultOgImageAssetId: "nope" })).toEqual({});
  });
});

describe("applyTitleTemplate", () => {
  it("substitutes %s with the page title", () => {
    expect(applyTitleTemplate("%s — Acme", "About")).toBe("About — Acme");
  });

  it("returns the page title unchanged when template is missing or has no %s", () => {
    expect(applyTitleTemplate(undefined, "About")).toBe("About");
    expect(applyTitleTemplate("Acme", "About")).toBe("About");
  });

  it("inserts a title containing $ specials literally (no replace-pattern interpretation)", () => {
    expect(applyTitleTemplate("%s — Acme", "Save $$ Today")).toBe("Save $$ Today — Acme");
    expect(applyTitleTemplate("%s — Acme", "A $& B")).toBe("A $& B — Acme");
  });
});

// D913 — bare "Blog"/"Events"/page titles shipped without site identity when
// no titleTemplate was configured (verified live: <title>Blog</title>).
describe("defaultTitleTemplate (D913)", () => {
  it("suffixes the site name when the title doesn't carry it", () => {
    expect(applyTitleTemplate(defaultTitleTemplate("Muldoon Dental", "Blog"), "Blog")).toBe(
      "Blog — Muldoon Dental",
    );
  });

  it("returns no template when the title already contains the site name (no doubling)", () => {
    expect(defaultTitleTemplate("Muldoon Dental", "Muldoon Dental — Family Dentistry")).toBeUndefined();
    expect(defaultTitleTemplate("Muldoon Dental", "muldoon dental")).toBeUndefined();
  });

  it("returns no template for an empty site name", () => {
    expect(defaultTitleTemplate("", "Blog")).toBeUndefined();
    expect(defaultTitleTemplate("   ", "Blog")).toBeUndefined();
  });
});

describe("normalizeTwitterHandle", () => {
  it("adds a leading @ and is idempotent", () => {
    expect(normalizeTwitterHandle("acme")).toBe("@acme");
    expect(normalizeTwitterHandle("@acme")).toBe("@acme");
  });

  it("returns undefined for empty/undefined", () => {
    expect(normalizeTwitterHandle(undefined)).toBeUndefined();
    expect(normalizeTwitterHandle("")).toBeUndefined();
  });
});
