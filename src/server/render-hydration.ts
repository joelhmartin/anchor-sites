import type { Pool } from "pg";
import type { Block } from "../blocks/types.js";
import type { MediaAssetData } from "@anchorcorps/components";
import { collectAssetIdsDeep } from "../blocks/asset-scan.js";

/**
 * Page-block media hydration (P3-T3.14).
 *
 * The renderer walks a page's blocks to find every referenced
 * media_asset id, queries the rows in one shot, and returns
 * `MediaAssetData[]` shaped for the package's `MediaProvider`.
 * The Image block (3.12) and Hero Slider (3.13) consume these via
 * `useMediaContext`.
 */

/**
 * D901 (W2-CONC): this used to be a private per-block allowlist
 * (`props.asset_id` + `props.slides[].image_asset_id`) that silently missed
 * `nav-bar`'s `logo_asset_id` and `split-hero`'s top-level `image_asset_id`
 * — those assets were never queried, so nav logos and split-hero images
 * rendered as missing-asset placeholders on published pages, previews, and
 * materialized templates. Now it delegates to the ONE shared generic
 * `/asset_id$/i` scanner git-import already validated against
 * (src/blocks/asset-scan.ts), so the renderer and the import gate can never
 * again disagree about what a block references.
 */
export function collectAssetIds(blocks: Block[] | undefined | null): string[] {
  return [...collectAssetIdsDeep(blocks ?? [])];
}

/**
 * Load `media_assets` rows + project to the public `MediaAssetData`
 * shape. Filters out rows whose variants haven't completed processing —
 * the Image block's missing-asset placeholder handles those.
 */
export async function loadAssetsForBlocks(
  pool: Pool,
  siteId: string,
  blocks: Block[] | undefined | null,
): Promise<MediaAssetData[]> {
  const ids = collectAssetIds(blocks);
  if (ids.length === 0) return [];
  const res = await pool.query<{
    id: string;
    alt: string;
    width: number | null;
    height: number | null;
    focal_point: { x: number; y: number } | null;
    variants: MediaAssetData["variants"] | null;
  }>(
    `SELECT id, alt, width, height, focal_point, variants
       FROM media_assets
      WHERE site_id = $1
        AND id = ANY($2::uuid[])
        AND variants_status = 'ready'`,
    [siteId, ids],
  );
  return res.rows.map((r) => ({
    id: r.id,
    alt: r.alt ?? "",
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    focal_point: r.focal_point,
    variants: r.variants ?? [],
  }));
}
