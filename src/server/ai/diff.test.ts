import { describe, expect, it } from "vitest";
import type { Block } from "../../blocks/types.js";
import { diffBlocks } from "./diff.js";

const b = (id: string, type = "hero", props: Record<string, unknown> = {}): Block => ({ id, type, props });

describe("diffBlocks (P6-T6.4)", () => {
  it("reports no changes for identical block arrays", () => {
    const blocks = [b("1"), b("2")];
    const d = diffBlocks(blocks, structuredClone(blocks));
    expect(d.summary).toBe("No changes");
    expect(d.unchanged).toBe(2);
    expect(d).toMatchObject({ added: [], removed: [], updated: [], moved: [] });
  });

  it("detects an added block", () => {
    const d = diffBlocks([b("1")], [b("1"), b("2", "cta")]);
    expect(d.added).toEqual([{ id: "2", type: "cta" }]);
    expect(d.summary).toContain("1 added");
  });

  it("detects a removed block", () => {
    const d = diffBlocks([b("1"), b("2")], [b("1")]);
    expect(d.removed).toEqual([{ id: "2", type: "hero" }]);
    expect(d.summary).toContain("1 removed");
  });

  it("detects an updated block by props change", () => {
    const d = diffBlocks([b("1", "hero", { title: "A" })], [b("1", "hero", { title: "B" })]);
    expect(d.updated).toEqual([{ id: "1", type: "hero" }]);
    expect(d.unchanged).toBe(0);
  });

  it("does NOT flag survivors as moved when a block is inserted at the top", () => {
    const before = [b("1"), b("2")];
    const after = [b("3", "cta"), b("1"), b("2")];
    const d = diffBlocks(before, after);
    expect(d.moved).toEqual([]);
    expect(d.added).toEqual([{ id: "3", type: "cta" }]);
    expect(d.unchanged).toBe(2);
  });

  it("detects a real reorder of common blocks", () => {
    const d = diffBlocks([b("1"), b("2")], [b("2"), b("1")]);
    expect(d.moved.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(d.summary).toContain("moved");
  });
});
