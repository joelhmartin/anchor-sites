import { registerBlock } from "../registry.js";
import { richTextSchema } from "./schema.js";
import { RichText } from "./component.js";

/** The rich-text registry entry, exported so the editor's Config tests can
 * re-register it deterministically without duplicating its metadata. */
export const richTextBlock = {
  schema: richTextSchema,
  component: RichText,
  label: "Rich text",
  description: "Body copy with headings, links, and lists. Tiptap-edited in Phase 5.",
  aiHints: "Output well-formed HTML. Headings start at h2 (the Hero owns h1).",
  category: "content",
};

registerBlock("rich-text", richTextBlock);

export { richTextSchema, RichText };
