import { z } from "zod";
import { blockShape } from "../../blocks/validate.js";
import { seoFieldsSchema } from "../seo/schema.js";

/**
 * Event input schemas (P8-T8.10, D-047). `description` is a `Block[]` (D-001),
 * validated against the registry by the repo (D-039). Dates accept ISO strings
 * or `Date` (coerced).
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const eventSlugField = z
  .string()
  .regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen");

export const eventStatusSchema = z.enum(["draft", "published"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const eventInputSchema = z.object({
  slug: eventSlugField,
  title: z.string().min(1).max(200),
  description: z.array(blockShape).default([]),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date().optional(),
  location: z.string().max(300).optional(),
  seo: seoFieldsSchema.default({}),
  status: eventStatusSchema.default("draft"),
});
// `z.input` so defaults (description, status) are optional for callers.
export type EventInput = z.input<typeof eventInputSchema>;

export const eventPatchSchema = eventInputSchema.partial();
export type EventPatch = z.input<typeof eventPatchSchema>;
