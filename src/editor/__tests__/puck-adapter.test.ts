import { describe, expect, it } from "vitest";
import type { Block } from "../../blocks/types.js";
import { CHILDREN_ZONE, fromPuckData, toPuckData } from "../puck-adapter.js";

const roundTrip = (blocks: Block[]): Block[] => fromPuckData(toPuckData(blocks));

describe("puck-adapter Block[] <-> Data round-trip (P5-T5.2 / D-036)", () => {
  it("round-trips an empty page", () => {
    expect(roundTrip([])).toStrictEqual([]);
    expect(toPuckData([])).toStrictEqual({ root: {}, content: [] });
  });

  it("round-trips flat blocks with assorted prop types", () => {
    const blocks: Block[] = [
      { id: "a1", type: "hero", props: { heading: "Hi", align: "center", count: 3, on: true } },
      { id: "b2", type: "cta", props: { label: "Go", href: "/x", nested: { a: [1, 2], b: null } } },
      { id: "c3", type: "rich-text", props: {} },
    ];
    expect(roundTrip(blocks)).toStrictEqual(blocks);
  });

  it("round-trips deeply nested children", () => {
    const blocks: Block[] = [
      {
        id: "sec1",
        type: "section",
        props: { bg: "navy" },
        children: [
          { id: "h1", type: "hero", props: { heading: "Nested" } },
          {
            id: "row1",
            type: "row",
            props: {},
            children: [{ id: "img1", type: "image", props: { asset_id: "z" } }],
          },
        ],
      },
      { id: "top2", type: "cta", props: { label: "Top-level sibling" } },
    ];
    expect(roundTrip(blocks)).toStrictEqual(blocks);
  });

  it("preserves an empty children array distinctly from absent children", () => {
    const withEmpty: Block[] = [{ id: "e1", type: "section", props: {}, children: [] }];
    const without: Block[] = [{ id: "n1", type: "section", props: {} }];
    expect(roundTrip(withEmpty)).toStrictEqual(withEmpty);
    expect(roundTrip(without)).toStrictEqual(without);
    // The two are not conflated.
    expect(roundTrip(without)[0]).not.toHaveProperty("children");
    expect(roundTrip(withEmpty)[0].children).toStrictEqual([]);
  });

  it("passes unknown block types through unchanged (structural, no registry)", () => {
    const blocks: Block[] = [
      { id: "u1", type: "totally-made-up-block", props: { whatever: 42 } },
    ];
    expect(roundTrip(blocks)).toStrictEqual(blocks);
  });

  it("stores the block id inside props.id and children in zones (Puck contract)", () => {
    const blocks: Block[] = [
      { id: "p1", type: "hero", props: { heading: "H" }, children: [{ id: "k1", type: "cta", props: {} }] },
    ];
    const data = toPuckData(blocks);
    expect(data.content[0]).toStrictEqual({ type: "hero", props: { heading: "H", id: "p1" } });
    expect(data.zones).toStrictEqual({
      [`p1:${CHILDREN_ZONE}`]: [{ type: "cta", props: { id: "k1" } }],
    });
  });

  it("strips the Puck id back out of props on the way home", () => {
    const data = { root: {}, content: [{ type: "cta", props: { id: "x9", label: "L" } }] };
    expect(fromPuckData(data)).toStrictEqual([{ id: "x9", type: "cta", props: { label: "L" } }]);
  });
});
