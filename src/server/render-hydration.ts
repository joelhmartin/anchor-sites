import type { Pool } from "pg";
import type { Block } from "../blocks/types.js";
import type { MediaAssetData } from "@anchorcorps/components";

/**
 * Page-block media hydration (P3-T3.14).
 *
 * The renderer walks a page's blocks to find every referenced
 * media_asset id, queries the rows in one shot, and returns
 * `MediaAssetData[]` shaped for the package's `MediaProvider`.
 * The Image block (3.12) and Hero Slider (3.13) consume these via
 * `useMediaContext`.
 */

/** Walk every block + descendant, pull asset ids. Order isn't important. */
export function collectAssetIds(blocks: Block[] | undefined | null): string[] {
  const out: string[] = [];
  if (!blocks) return out;
  const visit = (block: Block) => {
    const props = (block.props ?? {}) as Record<string, unknown>;
    if (typeof props.asset_id === "string" && props.asset_id) {
      out.push(props.asset_id);
    }
    // Hero-slider style: props.slides = [{ image_asset_id: ... }, ...]
    if (Array.isArray(props.slides)) {
      for (const slide of props.slides) {
        if (slide && typeof slide === "object") {
          const sid = (slide as Record<string, unknown>).image_asset_id;
          if (typeof sid === "string" && sid) out.push(sid);
        }
      }
    }
    if (Array.isArray(block.children)) {
      for (const c of block.children) visit(c);
    }
  };
  for (const b of blocks) visit(b);
  return Array.from(new Set(out));
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
