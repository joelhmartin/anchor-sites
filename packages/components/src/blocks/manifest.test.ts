import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blockManifest, registerAll } from "./manifest.js";
import type { BlockManifestEntry } from "./manifest.js";

const REQUIRED_KEYS = [
  "type",
  "schema",
  "component",
  "label",
  "description",
  "category",
] as const;

const VALID_CATEGORIES = new Set(["header", "content", "cta", "layout"]);

describe("blockManifest contract", () => {
  it("has the expected count for the current minor (9 in v0.4)", () => {
    expect(blockManifest.length).toBe(9);
  });

  it("contains the v0.2 Image block", () => {
    expect(blockManifest.map((e) => e.type)).toContain("image");
  });

  it("contains the v0.4 phone_number + crm_form blocks", () => {
    const types = blockManifest.map((e) => e.type);
    expect(types).toContain("phone_number");
    expect(types).toContain("crm_form");
  });

  it("each entry has every required field with a sensible value", () => {
    for (const entry of blockManifest) {
      for (const key of REQUIRED_KEYS) {
        expect(entry[key as keyof BlockManifestEntry], `entry[${entry.type}].${key}`).toBeDefined();
      }
      expect(typeof entry.type).toBe("string");
      expect(entry.type.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(VALID_CATEGORIES.has(entry.category)).toBe(true);
    }
  });

  it("every type is unique", () => {
    const types = blockManifest.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("every schema is a Zod object so introspection works (D-002)", () => {
    for (const entry of blockManifest) {
      expect(entry.schema, `entry[${entry.type}].schema`).toBeInstanceOf(z.ZodObject);
    }
  });

  it("every schema accepts its declared defaults (parse with {} succeeds)", () => {
    for (const entry of blockManifest) {
      const result = entry.schema.safeParse({});
      expect(result.success, `entry[${entry.type}] failed defaults: ${result.success ? "" : JSON.stringify(result.error.errors)}`).toBe(true);
    }
  });

  it("every component is callable (React component contract — plain fn or React.memo object)", () => {
    for (const entry of blockManifest) {
      const t = typeof entry.component;
      // React.memo returns a MemoExoticComponent (object); plain function components return "function"
      expect(t === "function" || (t === "object" && entry.component !== null), `entry[${entry.type}].component must be a React renderable`).toBe(true);
    }
  });

  it("contains the Phase 1 ports (hero + cta) so existing seed renders unchanged", () => {
    const types = blockManifest.map((e) => e.type);
    expect(types).toContain("hero");
    expect(types).toContain("cta");
  });
});

describe("registerAll", () => {
  it("invokes the caller's register fn once per manifest entry, in order, with type + rest", () => {
    const calls: Array<{ type: string; keys: string[] }> = [];
    registerAll((type, entry) => {
      calls.push({ type, keys: Object.keys(entry).sort() });
    });
    expect(calls.length).toBe(blockManifest.length);
    expect(calls.map((c) => c.type)).toEqual(blockManifest.map((e) => e.type));
    // Each call carries everything except `type` (which is passed as the first arg)
    for (const c of calls) {
      expect(c.keys).toEqual(
        expect.arrayContaining(["schema", "component", "label", "description", "category"]),
      );
      expect(c.keys).not.toContain("type");
    }
  });
});
