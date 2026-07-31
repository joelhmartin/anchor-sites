/**
 * W2-CONC / D901 — THE generic asset-reference scanner, shared by every
 * consumer that needs "which media assets does this block tree reference?".
 *
 * One rule, no per-block allowlist: ANY string value under a key matching
 * `/asset_id$/i`, at any depth. That covers the flat `image` block's
 * `asset_id`, `nav-bar`'s `logo_asset_id`, `split-hero`'s top-level
 * `image_asset_id`, the nested `hero-slider` shape's
 * `slides[].image_asset_id`, and any future block's `*_asset_id` field the
 * day it's added — which is exactly how the D901 defect happened: the
 * renderer's private allowlist (`props.asset_id` + `slides[].image_asset_id`)
 * silently missed nav-bar logos and split-hero images, so they rendered as
 * missing-asset placeholders on published pages, previews, AND materialized
 * templates, while git-import's own copy of the generic scan validated them
 * fine.
 *
 * Consumers: render-hydration.ts (tenant render, preview, blog/events),
 * git-import.ts (asset-existence validation). Keep it that way — a new
 * consumer imports THIS module; it does not grow its own walk.
 */

const ASSET_ID_KEY_RE = /asset_id$/i;

/**
 * Recursively collect every `*asset_id`-keyed non-empty string in `value`
 * (objects and arrays at any depth). Insertion-ordered, deduped.
 */
export function collectAssetIdsDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIdsDeep(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ASSET_ID_KEY_RE.test(key) && typeof child === "string" && child) {
        out.add(child);
      } else {
        collectAssetIdsDeep(child, out);
      }
    }
  }
  return out;
}
