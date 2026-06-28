import { z } from "zod";
import { blockShape } from "../../blocks/validate.js";
import { seoFieldsSchema } from "../seo/schema.js";

/**
 * Blog post input schemas (P8-T8.9, D-047). `body` is a `Block[]` (D-001) —
 * structurally validated here (`blockShape`) and semantically against the
 * registry by the repo (`validateBlocks`, D-039), so a post can never hold
 * blocks the renderer/save path would reject.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const postSlugField = z
  .string()
  .regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen");

export const postStatusSchema = z.enum(["draft", "published"]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const postInputSchema = z.object({
  slug: postSlugField,
  title: z.string().min(1).max(200),
  excerpt: z.string().max(500).optional(),
  body: z.array(blockShape).default([]),
  seo: seoFieldsSchema.default({}),
  status: postStatusSchema.default("draft"),
  author_id: z.string().optional(),
});
// `z.input` (not `infer`/`output`) so fields with `.default()` (body, status)
// are OPTIONAL for callers — the repo's `.parse()` fills them in.
export type PostInput = z.input<typeof postInputSchema>;

export const postPatchSchema = postInputSchema.partial();
export type PostPatch = z.input<typeof postPatchSchema>;
