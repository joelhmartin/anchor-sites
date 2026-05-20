import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { blockManifest } from "@anchorcorps/components";
import { __resetRegistryForTests, listBlocks, registerBlock } from "../../blocks/registry.js";
import { richTextBlock } from "../../blocks/rich-text/index.js";
import { zodSchemaDefaults, zodToPuckFields } from "../zod-fields.js";
import { buildPuckConfig } from "../puck-config.js";

// The registry is process-global mutable state shared across the test fork
// (other suites reset it). Re-establish a known state from authoritative
// sources before each test so ordering can't affect us.
beforeEach(() => {
  __resetRegistryForTests();
  for (const entry of blockManifest) {
    const { type, ...rest } = entry;
    registerBlock(type, rest);
  }
  registerBlock("rich-text", richTextBlock);
});

describe("buildPuckConfig (P5-T5.4)", () => {
  it("includes a component for every registered block", () => {
    const config = buildPuckConfig();
    const registered = listBlocks().map((b) => b.type).sort();
    expect(Object.keys(config.components).sort()).toEqual(registered);
  });

  it("covers the inline rich-text + every @anchorcorps/components block", () => {
    const config = buildPuckConfig();
    for (const type of [
      "rich-text",
      "hero",
      "hero-slider",
      "cta",
      "testimonial-carousel",
      "logo-reel",
      "faq-accordion",
      "image",
    ]) {
      expect(config.components[type], `missing ${type}`).toBeDefined();
    }
  });

  it("derives fields, defaultProps, label, and render from each registry entry", () => {
    const config = buildPuckConfig();
    for (const { type, entry } of listBlocks()) {
      const component = config.components[type];
      expect(component.label).toBe(entry.label);
      expect(component.fields).toEqual(zodToPuckFields(entry.schema));
      expect(component.defaultProps).toEqual(zodSchemaDefaults(entry.schema));
      // render is the SAME component the prod renderer uses (no editor fork).
      expect(component.render).toBe(entry.component);
    }
  });

  it("defaultProps parse cleanly against the block's own schema (valid starting props)", () => {
    for (const { entry } of listBlocks()) {
      expect(() => entry.schema.parse(zodSchemaDefaults(entry.schema))).not.toThrow();
    }
  });

  it("picks up plugin-registered blocks automatically (D-016)", () => {
    const PluginPromo = () => null;
    registerBlock("plugin-promo", {
      schema: z.object({ message: z.string().default("") }),
      component: PluginPromo,
      label: "Promo",
      description: "plugin fixture",
      category: "plugin",
    });
    const config = buildPuckConfig();
    expect(config.components["plugin-promo"]).toBeDefined();
    expect(config.components["plugin-promo"].render).toBe(PluginPromo);
  });
});
