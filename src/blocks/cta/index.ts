import { registerBlock } from "../registry.js";
import { ctaSchema } from "./schema.js";
import { Cta } from "./component.js";

registerBlock("cta", {
  schema: ctaSchema,
  component: Cta,
  label: "CTA banner",
  description: "Conversion-focused band with heading, supporting copy, and a button.",
  aiHints: "Use sparingly — typically one per page near the bottom or after a key section.",
  category: "cta",
});

export { ctaSchema, Cta };
