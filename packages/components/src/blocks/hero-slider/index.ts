import type { BlockManifestEntry } from "../manifest.js";
import { heroSliderSchema } from "./schema.js";
import { HeroSlider } from "./component.js";

export const heroSliderEntry: BlockManifestEntry<typeof heroSliderSchema> = {
  type: "hero-slider",
  schema: heroSliderSchema,
  component: HeroSlider,
  label: "Hero slider",
  description: "Multi-slide hero with optional autoplay; scroll-snap slides that work without JS.",
  aiHints:
    "Prefer 2-4 slides. Each slide title should stay under 8 words. Use only at top of page.",
  category: "header",
};
