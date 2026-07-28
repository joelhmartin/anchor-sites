export type Variant = {
  name: string;
  format: string;
  width: number;
  height: number;
  url: string;
  bytes: number;
};

/**
 * Media variant selection helpers (extracted from `MediaTab` for Task 10 —
 * the image picker's Library source needs the same "which variant do I
 * show/use" logic).
 */

/** Smallest ready variant for a thumbnail; prefer webp on a width tie. */
export function pickThumb(variants: Variant[] | null): Variant | null {
  if (!variants || variants.length === 0) return null;
  return [...variants].sort(
    (a, b) => a.width - b.width || (a.format === "webp" ? -1 : 1),
  )[0];
}

/**
 * Largest ready variant, preferring jpg — used when an image is actually
 * inserted into content (broadest compatibility), as opposed to
 * `pickThumb`'s compact grid preview.
 */
export function pickLargest(variants: Variant[] | null): Variant | null {
  if (!variants || variants.length === 0) return null;
  const jpg = variants.filter((v) => v.format === "jpg");
  const candidates = jpg.length > 0 ? jpg : variants;
  return [...candidates].sort((a, b) => b.width - a.width)[0];
}
