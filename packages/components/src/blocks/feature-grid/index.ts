import type { BlockManifestEntry } from "../manifest.js";
import { featureGridSchema } from "./schema.js";
import { FeatureGrid } from "./component.js";

export const featureGridEntry: BlockManifestEntry<typeof featureGridSchema> = {
  type: "feature-grid",
  schema: featureGridSchema,
  component: FeatureGrid,
  label: "Feature grid",
  description: "3-6 icon + title + body items in a responsive grid (3/2/1 columns).",
  aiHints: "3-6 items reads cleanest. Keep each title under 5 words and body to one sentence.",
  category: "content",
};
