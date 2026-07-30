import type { BlockManifestEntry } from "../manifest.js";
import { richFooterSchema } from "./schema.js";
import { RichFooter } from "./component.js";

export const richFooterEntry: BlockManifestEntry<typeof richFooterSchema> = {
  type: "rich-footer",
  schema: richFooterSchema,
  component: RichFooter,
  label: "Rich footer",
  description: "Multi-column footer: link groups, social links, hours, and small print.",
  aiHints: "Use once, at the end of the page. Keep column headings under 3 words.",
  category: "layout",
};
