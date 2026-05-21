import { beforeEach, describe, expect, it } from "vitest";
import { blockManifest } from "@anchorcorps/components";
import { __resetRegistryForTests, registerBlock } from "../../blocks/registry.js";
import { richTextBlock } from "../../blocks/rich-text/index.js";
import type { Block } from "../../blocks/types.js";
import { applyAndValidate, applyEditOps, editOpsSchema } from "./edit-ops.js";

// Re-establish a known registry (other suites reset it). See puck-config.test.ts.
beforeEach(() => {
  __resetRegistryForTests();
  for (const entry of blockManifest) {
    const { type, ...rest } = entry;
    registerBlock(type, rest);
  }
  registerBlock("rich-text", richTextBlock);
});

const base = (): Block[] => [
  { id: "b1", type: "hero", props: { title: "Hello" } },
  { id: "b2", type: "rich-text", props: { html: "<p>Hi</p>" } },
];

// Deterministic id generator for assertions.
function seqIds() {
  let n = 0;
  return () => `new${++n}`;
}

describe("editOpsSchema (contract)", () => {
  it("defaults place to 'end' and accepts optional after_id", () => {
    const [op] = editOpsSchema.parse([
      { op: "insert_block", block: { type: "cta" } },
    ]);
    expect(op).toMatchObject({ op: "insert_block", place: "end" });
    // block.props defaults to {}
    if (op.op === "insert_block") expect(op.block.props).toEqual({});
  });

  it("rejects an unknown op via the discriminated union", () => {
    expect(() => editOpsSchema.parse([{ op: "frobnicate", id: "x" }])).toThrow();
  });
});

describe("applyEditOps", () => {
  it("insert_block appends at end by default and generates an id", () => {
    const ops = editOpsSchema.parse([
      { op: "insert_block", block: { type: "cta", props: {} } },
    ]);
    const res = applyEditOps(base(), ops, { genId: seqIds() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.blocks.map((b) => b.id)).toEqual(["b1", "b2", "new1"]);
    expect(res.blocks[2]).toMatchObject({ id: "new1", type: "cta", props: {} });
  });

  it("insert_block at start and after a given id", () => {
    const ops = editOpsSchema.parse([
      { op: "insert_block", block: { type: "cta" }, place: "start" },
      { op: "insert_block", block: { type: "logo-reel" }, place: "after", after_id: "b1" },
    ]);
    const res = applyEditOps(base(), ops, { genId: seqIds() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // start → new1 first; then after b1 → new2 between b1 and b2
    expect(res.blocks.map((b) => b.id)).toEqual(["new1", "b1", "new2", "b2"]);
  });

  it("update_block shallow-merges props (existing keys preserved)", () => {
    const ops = editOpsSchema.parse([
      { op: "update_block", id: "b1", props: { subtitle: "now with a subtitle" } },
    ]);
    const res = applyEditOps(base(), ops);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.blocks[0].props).toEqual({ title: "Hello", subtitle: "now with a subtitle" });
  });

  it("delete_block removes by id", () => {
    const ops = editOpsSchema.parse([{ op: "delete_block", id: "b1" }]);
    const res = applyEditOps(base(), ops);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.blocks.map((b) => b.id)).toEqual(["b2"]);
  });

  it("move_block relocates an existing block", () => {
    const ops = editOpsSchema.parse([{ op: "move_block", id: "b1", place: "end" }]);
    const res = applyEditOps(base(), ops);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.blocks.map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("does not mutate the input array or its blocks (pure)", () => {
    const input = base();
    const ops = editOpsSchema.parse([{ op: "update_block", id: "b1", props: { title: "Changed" } }]);
    applyEditOps(input, ops);
    expect(input[0].props).toEqual({ title: "Hello" });
    expect(input).toHaveLength(2);
  });

  it("rejects update/delete/move on a missing id (no partial apply)", () => {
    for (const op of [
      { op: "update_block", id: "ghost", props: {} },
      { op: "delete_block", id: "ghost" },
      { op: "move_block", id: "ghost", place: "end" },
    ]) {
      const res = applyEditOps(base(), editOpsSchema.parse([op]));
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.failures[0]).toMatchObject({ reason: "missing_id", detail: "ghost", op_index: 0 });
    }
  });

  it("rejects insert/move with place 'after' and an unknown after_id", () => {
    const ins = applyEditOps(
      base(),
      editOpsSchema.parse([{ op: "insert_block", block: { type: "cta" }, place: "after", after_id: "ghost" }]),
    );
    expect(ins.ok).toBe(false);
    if (!ins.ok) expect(ins.failures[0].reason).toBe("bad_placement");
  });
});

describe("applyAndValidate (the guardrail)", () => {
  it("accepts a valid edit and returns the proposed blocks", () => {
    const ops = editOpsSchema.parse([
      { op: "update_block", id: "b1", props: { title: "A punchier headline" } },
    ]);
    const res = applyAndValidate(base(), ops);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.blocks[0].props).toMatchObject({ title: "A punchier headline" });
  });

  it("rejects an unregistered block type at the validate stage (never applied)", () => {
    const ops = editOpsSchema.parse([
      { op: "insert_block", block: { type: "wormhole", props: {} } },
    ]);
    const res = applyAndValidate(base(), ops);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe("validate");
    if (res.stage === "validate") {
      expect(res.failures[0]).toMatchObject({ type: "wormhole", reason: "unknown_type" });
    }
  });

  it("rejects invalid props at the validate stage", () => {
    const ops = editOpsSchema.parse([
      { op: "insert_block", block: { type: "hero", props: { align: "diagonal" } } },
    ]);
    const res = applyAndValidate(base(), ops);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe("validate");
    if (res.stage === "validate") {
      expect(res.failures[0]).toMatchObject({ type: "hero", reason: "invalid_props" });
    }
  });

  it("surfaces an apply-stage failure (missing id) distinctly", () => {
    const ops = editOpsSchema.parse([{ op: "delete_block", id: "ghost" }]);
    const res = applyAndValidate(base(), ops);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("apply");
  });
});
