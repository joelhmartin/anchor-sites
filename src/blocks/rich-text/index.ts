import { registerBlock } from "../registry.js";
import { richTextSchema } from "./schema.js";
import { RichText } from "./component.js";

registerBlock("rich-text", {
  schema: richTextSchema,
  component: RichText,
  label: "Rich text",
  description: "Body copy with headings, links, and lists. Tiptap-edited in Phase 5.",
  aiHints: "Output well-formed HTML. Headings start at h2 (the Hero owns h1).",
  category: "content",
});

export { richTextSchema, RichText };
