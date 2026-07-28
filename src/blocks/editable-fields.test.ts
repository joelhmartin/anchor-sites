import { describe, expect, it } from "vitest";
// Side-effect: register the static blocks (mirrors src/server/ai/catalog.ts).
import "./index.js";
import { buildEditableFieldMap } from "./editable-fields.js";
import { listBlocks } from "./registry.js";

/**
 * Expectations below are pinned to the REAL block schemas (verified by
 * reading packages/components/src/blocks/*\/schema.ts and
 * src/blocks/rich-text/schema.ts), not the brief's illustrative examples.
 */
describe("buildEditableFieldMap (schema-derived classifier)", () => {
  it("classifies hero: text fields + cta_href as url, align (enum) excluded", () => {
    const map = buildEditableFieldMap();
    expect(map.hero).toEqual({
      eyebrow: "text",
      title: "text",
      subtitle: "text",
      cta_label: "text",
      cta_href: "url",
    });
    expect(map.hero.align).toBeUndefined();
  });

  it("classifies image: asset_id as image, alt + sizes as text; enums/numbers/objects excluded", () => {
    const map = buildEditableFieldMap();
    // `sizes` is a bare ZodString (no url check, no url/href/link/asset_id name
    // match) so per the classification rules it IS text — the brief's example
    // omitted it, but the rules are exhaustive over top-level shape entries.
    expect(map.image).toEqual({
      asset_id: "image",
      alt: "text",
      sizes: "text",
    });
    expect(map.image.fit).toBeUndefined(); // enum
    expect(map.image.aspect_ratio).toBeUndefined(); // number
    expect(map.image.focal_point).toBeUndefined(); // object
  });

  it("classifies rich-text: html as text, max_width (enum) excluded", () => {
    const map = buildEditableFieldMap();
    expect(map["rich-text"]).toEqual({ html: "text" });
  });

  it("classifies faq-accordion: heading as text; items (array) and multiple (boolean) excluded", () => {
    const map = buildEditableFieldMap();
    expect(map["faq-accordion"]).toEqual({ heading: "text" });
  });

  it("classifies cta: button_href as url (name match, no .url() check)", () => {
    const map = buildEditableFieldMap();
    expect(map.cta).toEqual({
      heading: "text",
      body: "text",
      button_label: "text",
      button_href: "url",
    });
    expect(map.cta.variant).toBeUndefined(); // enum
  });

  it("excludes top-level arrays even when their element schema has text/url fields (hero-slider)", () => {
    const map = buildEditableFieldMap();
    // `slides` is a ZodArray at the top level — rule 4 excludes arrays outright,
    // regardless of what the array's element schema looks like.
    expect(map["hero-slider"]).toEqual({});
  });

  it("covers every registered block type, with no extra keys beyond the registry", () => {
    const map = buildEditableFieldMap();
    const registeredTypes = listBlocks().map((b) => b.type).sort();
    expect(Object.keys(map).sort()).toEqual(registeredTypes);
  });
});
