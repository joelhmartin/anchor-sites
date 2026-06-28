import type { Pool } from "pg";
import type { MediaVariant } from "@anchorcorps/components";
import { parseSiteSeoDefaultsLoose, type SeoFields } from "./schema.js";

/**
 * og:image resolution (P9-T9.4, D-049). An og:image is a media `asset_id`
 * (page `seo.og.imageAssetId`, else the site default `defaultOgImageAssetId`),
 * resolved here to a concrete CDN variant URL so the head renderer and JSON-LD
 * can emit an absolute image. JPG is preferred (broadest scraper support);
 * largest reasonable variant wins.
 */

export type OgImage = { url: string; width?: number; height?: number; alt?: string };

const SIZE_ORDER: MediaVariant["name"][] = ["lg", "2x", "md", "sm", "thumbnail"];

/** Pick the best og:image variant: prefer jpg, then the largest by SIZE_ORDER. */
export function pickOgVariant(variants: MediaVariant[] | null | undefined): MediaVariant | null {
  if (!variants || variants.length === 0) return null;
  const jpg = variants.filter((v) => v.format === "jpg");
  const candidates = jpg.length > 0 ? jpg : variants;
  for (const name of SIZE_ORDER) {
    const hit = candidates.find((v) => v.name === name);
    if (hit) return hit;
  }
  return candidates[0];
}

/**
 * Resolve a single media asset to an `OgImage`, or null when the id is empty,
 * the asset isn't ready, or it's cross-site. Site-scoped (multi-tenant).
 */
export async function loadOgImage(
  pool: Pool,
  siteId: string,
  assetId: string | undefined | null,
): Promise<OgImage | null> {
  if (!assetId) return null;
  const res = await pool.query<{ alt: string | null; variants: MediaVariant[] | null }>(
    `SELECT alt, variants FROM media_assets
      WHERE site_id = $1 AND id = $2 AND variants_status = 'ready'
      LIMIT 1`,
    [siteId, assetId],
  );
  if (!res.rowCount) return null;
  const variant = pickOgVariant(res.rows[0].variants);
  if (!variant) return null;
  return {
    url: variant.url,
    width: variant.width,
    height: variant.height,
    alt: res.rows[0].alt ?? undefined,
  };
}

/**
 * Single source of truth for the og:image fallback chain (P9-T9.4): the
 * content's own `seo.og.imageAssetId`, else the site default
 * (`seo_defaults.defaultOgImageAssetId`). Used by the page and blog/event
 * routes so the precedence rule lives in one place.
 */
export function resolveOgImage(
  pool: Pool,
  site: { id: string; seo_defaults: Record<string, unknown> },
  seo: SeoFields,
): Promise<OgImage | null> {
  const defaults = parseSiteSeoDefaultsLoose(site.seo_defaults);
  return loadOgImage(pool, site.id, seo.og?.imageAssetId ?? defaults.defaultOgImageAssetId);
}
