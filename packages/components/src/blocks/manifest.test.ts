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
  it("has the expected count for the current minor (15, C2 batch 1: split-hero + feature-grid + stats-band + rich-footer + nav-bar + announcement-bar)", () => {
    expect(blockManifest.length).toBe(15);
  });

  it("contains the v0.2 Image block", () => {
    expect(blockManifest.map((e) => e.type)).toContain("image");
  });

  it("contains the v0.4 phone_number + crm_form blocks", () => {
    const types = blockManifest.map((e) => e.type);
    expect(types).toContain("phone_number");
    expect(types).toContain("crm_form");
  });

  // W1.6 follow-up — since D700, templates ship WORKING platform lead forms
  // posting to /api/leads; the model-facing hints must not still claim the
  // block renders nothing without an operator-configured CRM embed, or the
  // agent will route around a block that works out of the box.
  it("crm_form hints describe the platform lead form, not a render-nothing precondition", () => {
    const entry = blockManifest.find((e) => e.type === "crm_form")!;
    expect(entry.aiHints).toMatch(/\/api\/leads/);
    expect(entry.aiHints).not.toMatch(/renders as an empty gap/i);
    expect(entry.description).not.toMatch(/renders nothing/i);
    // Steer away from inventing third-party embeds.
    expect(entry.aiHints).toMatch(/never invent|don't invent|do not invent/i);
  });

  it("contains all six Task C2 batch-1 blocks", () => {
    const types = blockManifest.map((e) => e.type);
    expect(types).toContain("split-hero");
    expect(types).toContain("feature-grid");
    expect(types).toContain("stats-band");
    expect(types).toContain("rich-footer");
    expect(types).toContain("nav-bar");
    expect(types).toContain("announcement-bar");
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
