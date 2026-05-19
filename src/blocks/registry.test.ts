import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  registerBlock,
  getBlock,
  listBlocks,
  hasBlock,
  __resetRegistryForTests,
} from "./registry.js";

const dummySchema = z.object({ x: z.string().default("hi") });
const Dummy = () => null;
const entry = {
  schema: dummySchema,
  component: Dummy,
  label: "Dummy",
  description: "test fixture",
  category: "test",
};

describe("block registry", () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it("registers and retrieves a block", () => {
    registerBlock("dummy", entry);
    expect(hasBlock("dummy")).toBe(true);
    expect(getBlock("dummy")).toBe(entry);
  });

  it("returns undefined for unknown types", () => {
    expect(getBlock("nope")).toBeUndefined();
    expect(hasBlock("nope")).toBe(false);
  });

  it("throws on duplicate registration", () => {
    registerBlock("dummy", entry);
    expect(() => registerBlock("dummy", entry)).toThrow(/already registered/);
  });

  it("listBlocks returns every registered type", () => {
    registerBlock("a", entry);
    registerBlock("b", entry);
    const types = listBlocks().map((r) => r.type).sort();
    expect(types).toEqual(["a", "b"]);
  });
});
