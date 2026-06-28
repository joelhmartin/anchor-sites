import { z } from "zod";

/**
 * Shared per-content SEO fields (P9-T9.1, D-049). Stored in the `seo` JSONB
 * column on `pages` / `posts` / `events` — ONE shape across all three so the
 * head renderer (9.2), JSON-LD (9.4) and editor panel (9.7) treat them
 * uniformly.
 *
 * Extends the historical `{ title, description }` shape (previously stored as
 * an unvalidated `z.record(z.unknown())`) with canonical, robots, Open Graph
 * and Twitter fields. Everything is optional — an empty `{}` is valid, so
 * legacy rows and "no SEO set" both pass.
 *
 * `og.imageAssetId` is a media-library `asset_id` (D-003), NOT a raw URL — it
 * resolves to a CDN variant URL at render time (9.4), so og:image flows through
 * the same media pipeline as every other managed image.
 *
 * Unknown keys are STRIPPED (default Zod object behavior), not rejected, so a
 * save can never 400 on a stray legacy key.
 */

export const robotsSchema = z.object({
  index: z.boolean().default(true),
  follow: z.boolean().default(true),
});
export type Robots = z.infer<typeof robotsSchema>;

export const ogSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(320).optional(),
  imageAssetId: z.string().uuid().optional(),
});

export const twitterSchema = z.object({
  card: z.enum(["summary", "summary_large_image"]).optional(),
});

export const seoFieldsSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(320).optional(),
  canonical: z.string().url().max(2048).optional(),
  robots: robotsSchema.optional(),
  og: ogSchema.optional(),
  twitter: twitterSchema.optional(),
});

/** Parsed, normalized SEO fields. */
export type SeoFields = z.infer<typeof seoFieldsSchema>;

/**
 * Coerce an arbitrary stored value into validated `SeoFields`. Tolerant by
 * design: `null`/`undefined`/non-object → `{}`; invalid sub-fields are dropped
 * rather than thrown, because rendering must never fail on dirty stored SEO.
 */
export function parseSeoLoose(value: unknown): SeoFields {
  const result = seoFieldsSchema.safeParse(value ?? {});
  return result.success ? result.data : {};
}

/** Effective robots directive, applying the index/follow defaults. */
export function effectiveRobots(seo: SeoFields): Robots {
  return {
    index: seo.robots?.index ?? true,
    follow: seo.robots?.follow ?? true,
  };
}

/**
 * Site-level SEO defaults (P9-T9.3, D-049). Stored in `sites.seo_defaults`
 * JSONB; apply UNDER per-page `seo` (page wins). `titleTemplate` uses `%s` as
 * the page-title placeholder ("%s — Acme Dental"). `defaultOgImageAssetId` is a
 * media `asset_id` used when a page sets no og:image (resolved in 9.4).
 */
export const siteSeoDefaultsSchema = z.object({
  titleTemplate: z.string().max(120).optional(),
  defaultDescription: z.string().max(320).optional(),
  defaultOgImageAssetId: z.string().uuid().optional(),
  twitterHandle: z
    .string()
    .regex(/^@?[A-Za-z0-9_]{1,15}$/, "twitter handle must be 1-15 word chars, optional leading @")
    .optional(),
});
export type SiteSeoDefaults = z.infer<typeof siteSeoDefaultsSchema>;

/** Tolerant parse of a stored `seo_defaults` blob — never throws. */
export function parseSiteSeoDefaultsLoose(value: unknown): SiteSeoDefaults {
  const result = siteSeoDefaultsSchema.safeParse(value ?? {});
  return result.success ? result.data : {};
}

/** Apply the site `titleTemplate` to a page title. `%s` → page title; a
 * template without `%s` is ignored (returns the page title unchanged). */
export function applyTitleTemplate(template: string | undefined, pageTitle: string): string {
  if (!template || !template.includes("%s")) return pageTitle;
  return template.replace("%s", pageTitle);
}

/** Normalize a twitter handle to its `@handle` form (or undefined). */
export function normalizeTwitterHandle(handle: string | undefined): string | undefined {
  if (!handle) return undefined;
  const bare = handle.startsWith("@") ? handle.slice(1) : handle;
  return bare ? `@${bare}` : undefined;
}
