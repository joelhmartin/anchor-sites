import { describe, expect, it } from "vitest";
import { hasPlaceholderMarker, publicDisplayName } from "./public-name.js";

describe("D911 — placeholder markers never reach public surfaces", () => {
  it("strips a trailing '(placeholder)' marker", () => {
    expect(publicDisplayName("Muldoon Dental (placeholder)", "muldoon-dental")).toBe(
      "Muldoon Dental",
    );
  });

  it("is case- and spacing-insensitive", () => {
    expect(publicDisplayName("Acme ( Placeholder )", "acme")).toBe("Acme");
    expect(publicDisplayName("Acme (PLACEHOLDER)", "acme")).toBe("Acme");
  });

  it("strips a mid-name marker and collapses the leftover whitespace", () => {
    expect(publicDisplayName("Acme (placeholder) Dental", "acme")).toBe("Acme Dental");
  });

  it("leaves clean names untouched", () => {
    expect(publicDisplayName("AnchorCorps Demo Site", "demo-site")).toBe("AnchorCorps Demo Site");
    // A parenthetical that isn't a seed marker is real content.
    expect(publicDisplayName("Java (the island) Tours", "java-tours")).toBe(
      "Java (the island) Tours",
    );
  });

  it("falls back to the slug when the name was ONLY a marker", () => {
    expect(publicDisplayName("(placeholder)", "acme-dental")).toBe("acme-dental");
  });

  it("hasPlaceholderMarker detects markers for the Studio rename nudge", () => {
    expect(hasPlaceholderMarker("Muldoon Dental (placeholder)")).toBe(true);
    expect(hasPlaceholderMarker("Muldoon Dental")).toBe(false);
  });
});
