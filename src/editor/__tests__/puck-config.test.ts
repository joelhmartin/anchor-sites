import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { blockManifest } from "@anchorcorps/components";
import { __resetRegistryForTests, listBlocks, registerBlock } from "../../blocks/registry.js";
import { richTextBlock } from "../../blocks/rich-text/index.js";
import { zodSchemaDefaults, zodToPuckFields } from "../zod-fields.js";
import { applyFieldOverrides } from "../field-overrides.js";
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

  it("derives field types, label, defaultProps, and render from each registry entry", () => {
    const config = buildPuckConfig({ siteId: "s1" });
    for (const { type, entry } of listBlocks()) {
      const component = config.components[type];
      expect(component.label).toBe(entry.label);
      // Expected = schema-derived fields with the same overrides applied. Custom
      // fields carry a render fn (not deep-comparable), so compare by type.
      const expected = applyFieldOverrides(type, zodToPuckFields(entry.schema), { siteId: "s1" });
      for (const [key, field] of Object.entries(component.fields ?? {})) {
        expect(field.type).toBe(expected[key].type);
      }
      expect(component.defaultProps).toEqual(zodSchemaDefaults(entry.schema));
      // render is the SAME component the prod renderer uses (no editor fork).
      expect(component.render).toBe(entry.component);
    }
  });

  it("leaves a block with no overrides exactly as the schema derives it (cta)", () => {
    const cta = buildPuckConfig().components["cta"];
    const ctaEntry = listBlocks().find((b) => b.type === "cta")!.entry;
    expect(cta.fields).toEqual(zodToPuckFields(ctaEntry.schema));
  });

  it("overrides rich-text.html → Tiptap custom field; siblings keep schema fields", () => {
    const richText = buildPuckConfig().components["rich-text"];
    expect(richText.fields?.html?.type).toBe("custom"); // would be "text" without override
    expect(richText.fields?.max_width?.type).toBe("select");
  });

  it("overrides image.asset_id → media-picker custom field (P5-T5.7)", () => {
    const image = buildPuckConfig({ siteId: "s1" }).components["image"];
    expect(image.fields?.asset_id?.type).toBe("custom");
  });

  it("overrides hero-slider slides[].image_asset_id → media-picker (nested, P5-T5.7)", () => {
    const slider = buildPuckConfig({ siteId: "s1" }).components["hero-slider"];
    const slides = slider.fields?.slides as { type: string; arrayFields: Record<string, { type: string }> };
    expect(slides.type).toBe("array");
    expect(slides.arrayFields.image_asset_id.type).toBe("custom");
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
