import type { BlockManifestEntry } from "../manifest.js";
import { faqAccordionSchema } from "./schema.js";
import { FaqAccordion } from "./component.js";

export const faqAccordionEntry: BlockManifestEntry<typeof faqAccordionSchema> = {
  type: "faq-accordion",
  schema: faqAccordionSchema,
  component: FaqAccordion,
  label: "FAQ accordion",
  description: "Question + answer list, native details/summary expand/collapse (works without JS).",
  aiHints: "5-10 items reads cleanest. Keep questions under 12 words.",
  category: "content",
};
