import type { Field, Fields } from "./index.js";
import { tiptapField } from "./custom-fields/tiptap-field.js";
import { imageField } from "./custom-fields/image-field.js";

export type OverrideOpts = { siteId?: string };

/**
 * Apply per-block custom-field overrides on top of the schema-derived fields
 * (P5-T5.6/5.7+). `zodToPuckFields` picks a sensible field for every prop, but
 * some props need a richer editor than the Zod type implies:
 *
 *   - `rich-text.html`            (`z.string()` → text)  → Tiptap (5.6)
 *   - `image.asset_id`            (`z.string()` → text)  → media picker (5.7)
 *   - `hero-slider.slides[].image_asset_id` (nested)     → media picker (5.7)
 *
 * Mutates and returns the passed `fields` (freshly built per call, so safe).
 * Each override is guarded on the field existing, so a schema change can't
 * crash config assembly. Color (5.8) registers here too.
 */
export function applyFieldOverrides(type: string, fields: Fields, opts: OverrideOpts = {}): Fields {
  const f = fields as Record<string, Field>;

  switch (type) {
    case "rich-text": {
      if (f.html) f.html = tiptapField("Content");
      break;
    }
    case "image": {
      if (f.asset_id) f.asset_id = imageField("Image", opts.siteId);
      break;
    }
    case "hero-slider": {
      const slides = f.slides as { type?: string; arrayFields?: Record<string, Field> } | undefined;
      if (slides?.type === "array" && slides.arrayFields?.image_asset_id) {
        slides.arrayFields.image_asset_id = imageField("Slide image", opts.siteId);
      }
      break;
    }
  }

  return fields;
}
