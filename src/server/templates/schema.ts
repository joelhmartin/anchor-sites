import { z } from "zod";
import { blockShape, validateBlocks, type BlockShape, type ValidationFailure } from "../../blocks/validate.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";

/**
 * Template input schemas + the shared block-validation helper (P7-T7.2, D-041).
 *
 * A template is a reusable snapshot of pages (block JSON) + brand tokens. The
 * page blocks are validated against the SAME registry validator the page-save
 * path uses (`validateBlocks`, D-039), so a template can never hold blocks the
 * save path would later reject — the materializer (D-042) re-uses the save
 * path's validation too, closing the loop.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const slugField = z
  .string()
  .regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen");

export const templateKindSchema = z.enum(["site", "page"]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

export const templateStatusSchema = z.enum(["active", "archived"]);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

/**
 * One page captured into a template. `blocks` is validated structurally here
 * (blockShape) and semantically (against the registry) by `validateTemplatePages`.
 * `sort_order` is assigned by the repo from array position, not taken as input.
 */
export const templatePageInputSchema = z.object({
  slug: slugField,
  title: z.string().min(1).max(200),
  blocks: z.array(blockShape).default([]),
  seo: z.record(z.unknown()).default({}),
});
export type TemplatePageInput = z.infer<typeof templatePageInputSchema>;

export const createTemplateInputSchema = z.object({
  slug: slugField,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  kind: templateKindSchema.default("site"),
  source_site_id: z.string().uuid().nullable().optional(),
  brand_tokens: brandTokensSchema.optional(),
  pages: z.array(templatePageInputSchema).default([]),
  /** Gallery grouping label (e.g. "Basic"). Nullable — omit for un-grouped templates. */
  category: z.string().max(100).nullable().optional(),
  /** Gallery card thumbnail URL. Nullable — omit when no cover image exists yet. */
  cover_image_url: z.string().url().max(2000).nullable().optional(),
  /** Gallery display order (ascending); defaults to 0. */
  sort_order: z.number().int().default(0),
});
// `z.input` (not `z.infer`/`z.output`): callers may omit defaulted fields
// (kind, pages, per-page seo/blocks); `.parse()` fills them in.
export type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;

/** A page whose blocks failed registry validation, with the per-block failures. */
export type TemplatePageValidationFailure = {
  page_slug: string;
  failures: ValidationFailure[];
};

/**
 * Run the shared block validator across every captured page. Returns one entry
 * per page that has at least one invalid block; `[]` when all pages are valid.
 * Caller must have registered the static blocks (the repo imports them).
 */
export function validateTemplatePages(
  pages: { slug: string; blocks: BlockShape[] }[],
): TemplatePageValidationFailure[] {
  const out: TemplatePageValidationFailure[] = [];
  for (const page of pages) {
    const failures = validateBlocks(page.blocks);
    if (failures.length > 0) out.push({ page_slug: page.slug, failures });
  }
  return out;
}
