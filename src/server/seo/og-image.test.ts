import { describe, expect, it } from "vitest";
import { pickOgVariant } from "./og-image.js";
import type { MediaVariant } from "@anchorcorps/components";

const v = (name: MediaVariant["name"], format: MediaVariant["format"]): MediaVariant => ({
  name,
  format,
  width: 100,
  height: 100,
  url: `https://cdn/${name}.${format}`,
});

describe("pickOgVariant (P9-T9.4)", () => {
  it("returns null for empty/missing variants", () => {
    expect(pickOgVariant([])).toBeNull();
    expect(pickOgVariant(null)).toBeNull();
  });

  it("prefers jpg over webp", () => {
    const picked = pickOgVariant([v("lg", "webp"), v("lg", "jpg")]);
    expect(picked?.format).toBe("jpg");
  });

  it("prefers the largest size by SIZE_ORDER (lg > md > sm)", () => {
    const picked = pickOgVariant([v("sm", "jpg"), v("md", "jpg"), v("lg", "jpg")]);
    expect(picked?.name).toBe("lg");
  });

  it("falls back to webp when no jpg exists", () => {
    const picked = pickOgVariant([v("md", "webp"), v("sm", "webp")]);
    expect(picked?.format).toBe("webp");
    expect(picked?.name).toBe("md");
  });

  it("returns the first variant if none match SIZE_ORDER names", () => {
    const odd = { ...v("lg", "jpg"), name: "weird" as unknown as MediaVariant["name"] };
    expect(pickOgVariant([odd])).toBe(odd);
  });
});
