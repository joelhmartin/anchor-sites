import type { BlockManifestEntry } from "../manifest.js";
import { statsBandSchema } from "./schema.js";
import { StatsBand } from "./component.js";

export const statsBandEntry: BlockManifestEntry<typeof statsBandSchema> = {
  type: "stats-band",
  schema: statsBandSchema,
  component: StatsBand,
  label: "Stats band",
  description: "Full-bleed accent band with 2-5 stat callouts (value + label).",
  aiHints: "Use real, defensible numbers. Keep labels under 4 words.",
  category: "content",
};
