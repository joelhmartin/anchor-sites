import { describe, expect, it } from "vitest";
import { brandTokensSchema, mergeBrandTokens } from "./brand-tokens.js";

describe("brandTokensSchema (P3-T3.3 / D-029)", () => {
  it("accepts an empty object", () => {
    expect(brandTokensSchema.safeParse({}).success).toBe(true);
  });

  it("accepts the Phase 1 muldoon-dental + demo-site shapes", () => {
    expect(brandTokensSchema.safeParse({
      "--theme-main": "#0a3d62",
      "--theme-accent": "#f6b93b",
    }).success).toBe(true);

    expect(brandTokensSchema.safeParse({
      "--theme-main": "#1f1f1f",
      "--theme-accent": "#ffd60a",
    }).success).toBe(true);
  });

  it("accepts rgb / rgba / hsl / hsla", () => {
    expect(brandTokensSchema.safeParse({
      "--theme-main": "rgb(10, 20, 30)",
      "--theme-accent": "rgba(255, 255, 255, 0.5)",
      "--theme-surface": "hsl(120, 50%, 50%)",
      "--theme-muted": "hsla(0, 0%, 0%, 0.1)",
    }).success).toBe(true);
  });

  it("accepts var(--…) references", () => {
    expect(brandTokensSchema.safeParse({
      "--theme-on-main": "var(--theme-accent)",
      "--theme-fallback": "var(--theme-accent, #fff)",
    }).success).toBe(true);
  });

  it("accepts named colors and the css-wide keywords", () => {
    expect(brandTokensSchema.safeParse({
      "--theme-surface": "white",
      "--theme-shadow": "transparent",
    }).success).toBe(true);
  });

  it("rejects a key that doesn't start with --theme-", () => {
    const r = brandTokensSchema.safeParse({ "--brand-main": "#fff" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0].message).toMatch(/--theme-/);
    }
  });

  it("rejects an uppercased key", () => {
    const r = brandTokensSchema.safeParse({ "--theme-Main": "#fff" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed value (not hex/rgb/var/named)", () => {
    const r = brandTokensSchema.safeParse({ "--theme-main": "definitely-not-a-color" });
    expect(r.success).toBe(false);
  });

  it("rejects a javascript-like value", () => {
    const r = brandTokensSchema.safeParse({ "--theme-main": "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });

  it("rejects a hex with the wrong digit count", () => {
    expect(brandTokensSchema.safeParse({ "--theme-main": "#12" }).success).toBe(false);
    expect(brandTokensSchema.safeParse({ "--theme-main": "#12345" }).success).toBe(false);
    expect(brandTokensSchema.safeParse({ "--theme-main": "#1234567" }).success).toBe(false);
  });

  it("reports the offending key in the issue path", () => {
    const r = brandTokensSchema.safeParse({
      "--theme-main": "#fff",
      "--bad-key": "#000",
    });
    if (r.success) throw new Error("expected failure");
    expect(r.error.errors[0].path).toEqual(["--bad-key"]);
  });
});

describe("mergeBrandTokens (P3-T3.3)", () => {
  it("merges site default + page override; page wins per-key", () => {
    const out = mergeBrandTokens(
      { "--theme-main": "#000", "--theme-accent": "#aaa" },
      { "--theme-accent": "#fff", "--theme-on-accent": "#000" },
    );
    expect(out).toEqual({
      "--theme-main": "#000",
      "--theme-accent": "#fff",
      "--theme-on-accent": "#000",
    });
  });

  it("returns site defaults unchanged when override is null", () => {
    const out = mergeBrandTokens({ "--theme-main": "#000" }, null);
    expect(out).toEqual({ "--theme-main": "#000" });
  });

  it("returns override unchanged when site default is null", () => {
    const out = mergeBrandTokens(null, { "--theme-main": "#fff" });
    expect(out).toEqual({ "--theme-main": "#fff" });
  });

  it("skips non-string values silently (defense in depth)", () => {
    const out = mergeBrandTokens(
      { "--theme-main": "#000", "--theme-bad": 123 as unknown as string },
      null,
    );
    expect(out).toEqual({ "--theme-main": "#000" });
  });

  it("returns empty object when both inputs are null", () => {
    expect(mergeBrandTokens(null, null)).toEqual({});
  });
});
