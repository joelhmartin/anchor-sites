import type { Field } from "./index.js";
import { tiptapField } from "./custom-fields/tiptap-field.js";

/**
 * Per-block custom-field overrides (P5-T5.6+). `zodToPuckFields` derives a
 * sensible field for every schema prop, but some props need a richer editor
 * than the Zod type implies — e.g. `rich-text.html` is a `z.string()` (which
 * maps to a plain text input) but should be edited with Tiptap. Overrides are
 * merged OVER the schema-derived fields in `buildPuckConfig`, keyed by block
 * type → prop name. Image picker (5.7) and color (5.8) register here too.
 */
const OVERRIDES: Record<string, () => Record<string, Field>> = {
  "rich-text": () => ({ html: tiptapField("Content") }),
};

export function fieldOverridesFor(type: string): Record<string, Field> {
  return OVERRIDES[type]?.() ?? {};
}
