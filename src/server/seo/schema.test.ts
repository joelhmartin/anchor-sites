import { describe, expect, it } from "vitest";
import { effectiveRobots, parseSeoLoose, seoFieldsSchema } from "./schema.js";

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

  it("rejects a non-url canonical", () => {
    expect(seoFieldsSchema.safeParse({ canonical: "not a url" }).success).toBe(false);
  });

  it("rejects a non-uuid og image asset id", () => {
    expect(seoFieldsSchema.safeParse({ og: { imageAssetId: "nope" } }).success).toBe(false);
  });

  it("rejects an unknown twitter card type", () => {
    expect(seoFieldsSchema.safeParse({ twitter: { card: "player" } }).success).toBe(false);
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
