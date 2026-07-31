import { beforeEach, describe, expect, it } from "vitest";
import { blockManifest } from "@anchorcorps/components";
import {
  __resetRegistryForTests,
  getBlock,
  listBlocks,
  registerBlock,
} from "../../blocks/registry.js";
import { richTextBlock } from "../../blocks/rich-text/index.js";
import { buildBlockCatalog } from "./catalog.js";

// The registry is process-global mutable state shared across the test fork
// (other suites reset it — e.g. registry.test.ts). Re-establish a known state
// from authoritative sources before each test so ordering can't affect us.
// (Same pattern as src/editor/__tests__/puck-config.test.ts.)
beforeEach(() => {
  __resetRegistryForTests();
  for (const entry of blockManifest) {
    const { type, ...rest } = entry;
    registerBlock(type, rest);
  }
  registerBlock("rich-text", richTextBlock);
});

const EXPECTED_TYPES = [
  "rich-text",
  "hero",
  "hero-slider",
  "cta",
  "testimonial-carousel",
  "logo-reel",
  "faq-accordion",
  "image",
];

describe("buildBlockCatalog (P6-T6.2)", () => {
  it("includes every registered block, no more no less", () => {
    const catalog = buildBlockCatalog();
    expect(catalog.map((c) => c.type).sort()).toEqual(
      listBlocks().map((b) => b.type).sort(),
    );
    for (const t of EXPECTED_TYPES) {
      expect(catalog.find((c) => c.type === t), `missing ${t}`).toBeDefined();
    }
  });

  it("carries label/description/category/aiHints straight from the registry", () => {
    const catalog = buildBlockCatalog();
    for (const e of catalog) {
      const reg = getBlock(e.type)!;
      expect(e.label).toBe(reg.label);
      expect(e.description).toBe(reg.description);
      expect(e.category).toBe(reg.category);
      if (reg.aiHints) expect(e.aiHints).toBe(reg.aiHints);
      else expect(e.aiHints).toBeUndefined();
    }
    // A couple of the known-hinted blocks must surface their aiHints.
    expect(catalog.find((c) => c.type === "cta")!.aiHints).toMatch(/heading/i);
    expect(catalog.find((c) => c.type === "rich-text")!.aiHints).toMatch(/html/i);
  });

  it("W1.5/D1114: gated blocks carry model-facing precondition hints", () => {
    const catalog = buildBlockCatalog();

    const crmForm = catalog.find((c) => c.type === "crm_form")!;
    // The model must learn the block is dead without a configured CRM embed,
    // and what to reach for instead.
    expect(crmForm.aiHints).toMatch(/CRM embed is configured/i);
    expect(crmForm.aiHints).toMatch(/instead/i);
    // No internal-architecture leakage in the model-facing description.
    expect(crmForm.description).not.toMatch(/D-006|anchor-hub/);

    const phone = catalog.find((c) => c.type === "phone_number")!;
    expect(phone.aiHints).toMatch(/real phone number/i);
    expect(phone.aiHints).toMatch(/never invent/i);
    expect(phone.aiHints).toMatch(/CTM/);
  });

  it("each jsonSchema is a valid object schema that round-trips default props", () => {
    const catalog = buildBlockCatalog();
    for (const { type, jsonSchema } of catalog) {
      expect(jsonSchema).toBeTypeOf("object");
      expect((jsonSchema as { type?: unknown }).type).toBe("object");
      const props = (jsonSchema as { properties?: Record<string, unknown> }).properties;
      expect(props, `${type} has no properties`).toBeTypeOf("object");

      const reg = getBlock(type)!;
      // Every block is fully defaultable (every field has .default; optional
      // fields stay absent), so parse({}) yields the default-props instance.
      const defaults = reg.schema.parse({}) as Record<string, unknown>;
      for (const key of Object.keys(defaults)) {
        expect(props, `${type}.${key} missing from jsonSchema.properties`).toHaveProperty(key);
      }
      // True round-trip: re-parsing the defaults is stable.
      expect(reg.schema.parse(defaults)).toStrictEqual(defaults);
    }
  });

  it("is deterministic (byte-stable) so it can be prompt-cached", () => {
    expect(JSON.stringify(buildBlockCatalog())).toBe(JSON.stringify(buildBlockCatalog()));
  });
});
