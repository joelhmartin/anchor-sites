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

  it("recurses into block.children", () => {
    const blocks: Block[] = [
      {
        id: "wrap",
        type: "section",
        props: {},
        children: [{ id: "1", type: "image", props: { asset_id: "nested" } }],
      },
    ];
    expect(collectAssetIds(blocks)).toEqual(["nested"]);
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
