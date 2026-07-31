import { describe, expect, it } from "vitest";
import { collectAssetIds } from "./render-hydration.js";
import type { Block } from "../blocks/types.js";

describe("collectAssetIds (P3-T3.14)", () => {
  it("pulls asset_id from a flat Image block", () => {
    const blocks: Block[] = [
      { id: "1", type: "image", props: { asset_id: "a" } },
      { id: "2", type: "hero", props: { title: "x" } },
    ];
    expect(collectAssetIds(blocks)).toEqual(["a"]);
  });

  it("walks props.slides[] for hero-slider image_asset_ids", () => {
    const blocks: Block[] = [
      {
        id: "h",
        type: "hero-slider",
        props: {
          slides: [
            { image_asset_id: "s1", title: "A" },
            { image_asset_id: "s2", title: "B" },
            { image: "https://legacy.example.com/x.jpg", title: "C" },
          ],
        },
      },
    ];
    expect(collectAssetIds(blocks)).toEqual(["s1", "s2"]);
  });

  it("dedupes repeated ids", () => {
    const blocks: Block[] = [
      { id: "1", type: "image", props: { asset_id: "dup" } },
      { id: "2", type: "image", props: { asset_id: "dup" } },
      { id: "3", type: "image", props: { asset_id: "other" } },
    ];
    expect(collectAssetIds(blocks).sort()).toEqual(["dup", "other"]);
  });

  // ── D901: the generic scan catches every /asset_id$/i field — the old
  // per-block allowlist missed both of these, so nav logos and split-hero
  // images rendered as missing-asset placeholders everywhere. ──

  it("D901: pulls nav-bar's logo_asset_id", () => {
    const blocks: Block[] = [
      { id: "n", type: "nav-bar", props: { logo_asset_id: "logo-1", links: [] } },
    ];
    expect(collectAssetIds(blocks)).toEqual(["logo-1"]);
  });

  it("D901: pulls split-hero's top-level image_asset_id", () => {
    const blocks: Block[] = [
      { id: "s", type: "split-hero", props: { title: "T", image_asset_id: "img-1" } },
    ];
    expect(collectAssetIds(blocks)).toEqual(["img-1"]);
  });

  it("D901: pulls any future *_asset_id field at any depth (generic rule, no allowlist)", () => {
    const blocks: Block[] = [
      {
        id: "x",
        type: "future-gallery",
        props: { groups: [{ items: [{ background_asset_id: "deep-1" }] }] },
      },
    ];
    expect(collectAssetIds(blocks)).toEqual(["deep-1"]);
  });

  it("ignores empty/null/non-string asset ids", () => {
    const blocks: Block[] = [
      { id: "1", type: "image", props: { asset_id: "" } },
      { id: "2", type: "image", props: { asset_id: null } },
      { id: "3", type: "image", props: { asset_id: 42 } },
      { id: "4", type: "image", props: { asset_id: "ok" } },
    ];
    expect(collectAssetIds(blocks)).toEqual(["ok"]);
  });

  it("returns [] for null/undefined inputs", () => {
    expect(collectAssetIds(undefined)).toEqual([]);
    expect(collectAssetIds(null)).toEqual([]);
    expect(collectAssetIds([])).toEqual([]);
  });
});
