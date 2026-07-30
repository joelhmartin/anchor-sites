/**
 * Authoring types for the per-file template library (Task C4). One TS module
 * per template (see `starter.ts`) exports a single `TemplateSeed`; `index.ts`
 * collects them into `allTemplates` for `seed-templates.ts` to iterate.
 *
 * This is the harness tasks C5-C14 build on top of — keep it stable.
 */

/** One authored block. Structurally validated by `validateBlocks` (src/blocks/validate.ts)
 * against the live block registry before any template is written to the DB. */
export type TemplateBlockSeed = {
  id: string;
  type: string;
  props: Record<string, unknown>;
};

export type TemplatePageSeed = {
  slug: string;
  title: string;
  seo: Record<string, unknown>;
  blocks: TemplateBlockSeed[];
  /** Display order within the template (ascending). */
  sort_order: number;
};

/**
 * Gallery card thumbnail. Either:
 *   - `stock_query`: resolved through Pixabay search at seed time (see
 *     `resolveTemplateCover` in `seed-templates.ts`) — the top hit is ingested
 *     through the media pipeline under the reserved system-templates site and
 *     `cover_image_url` stores the resulting variant URL. Pixabay CDN URLs are
 *     never persisted (their API terms allow temporary display only).
 *   - `url`: ingested through the same pipeline, then stored as a variant URL.
 *   - `null`: no cover yet; the gallery card falls back to a placeholder.
 * Covers only resolve when PIXABAY_API_KEY + storage creds are present;
 * otherwise seeding cleanly skips and leaves `cover_image_url` null.
 */
export type TemplateCoverSeed = { stock_query: string; alt: string } | { url: string; alt: string } | null;

export type TemplateSeed = {
  slug: string;
  name: string;
  description: string;
  /** Gallery grouping label (e.g. "Basic"), or null to leave ungrouped. */
  category: string | null;
  /** Gallery display order (ascending) within its category. */
  sort_order: number;
  brand_tokens: Record<string, string>;
  cover: TemplateCoverSeed;
  pages: TemplatePageSeed[];
};
