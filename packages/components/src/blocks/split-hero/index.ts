import type { BlockManifestEntry } from "../manifest.js";
import { splitHeroSchema } from "./schema.js";
import { SplitHero } from "./component.js";

export const splitHeroEntry: BlockManifestEntry<typeof splitHeroSchema> = {
  type: "split-hero",
  schema: splitHeroSchema,
  component: SplitHero,
  label: "Split hero",
  description: "Two-column hero: copy on one side, a supporting image on the other.",
  aiHints: "Use for a top-of-page hero when a supporting photo is available. Keep heading under 10 words.",
  category: "header",
};
