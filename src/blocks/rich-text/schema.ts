import { z } from "zod";

export const richTextSchema = z.object({
  // HTML string. Phase 5 (D-017) will swap this for Tiptap-produced HTML.
  // Until then it's authored manually or by the AI editor (Phase 6).
  html: z.string().default("<p>Edit this text.</p>"),
  max_width: z.enum(["narrow", "medium", "wide"]).default("medium"),
});

export type RichTextProps = z.infer<typeof richTextSchema>;
