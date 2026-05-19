import type { BlockManifestEntry } from "../manifest.js";
import { ctaSchema } from "./schema.js";
import { Cta } from "./component.js";

export const ctaEntry: BlockManifestEntry<typeof ctaSchema> = {
  type: "cta",
  schema: ctaSchema,
  component: Cta,
  label: "Call to action",
  description: "Heading + body + button. Use mid-page or near the bottom of a page.",
  aiHints: "Keep heading under 7 words. Body to 1 short sentence.",
  category: "cta",
};
