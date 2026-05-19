/**
 * Variant catalog for the media pipeline (P3-T3.10 / D-031).
 *
 * Each variant has a name + max width. The job emits TWO formats per
 * variant (WebP + JPG) so the `<picture>` block can pick the best one
 * the browser accepts. Heights derive from the source aspect ratio.
 */

export type VariantName = "thumbnail" | "sm" | "md" | "lg" | "2x";
export type VariantFormat = "webp" | "jpg";

export const VARIANT_WIDTHS: Record<VariantName, number> = {
  thumbnail: 200,
  sm: 480,
  md: 768,
  lg: 1280,
  "2x": 2560,
};

export const VARIANT_FORMATS: VariantFormat[] = ["webp", "jpg"];

export type ProcessedVariant = {
  name: VariantName;
  format: VariantFormat;
  width: number;
  height: number;
  url: string;
  bytes: number;
};

/**
 * Construct the public CDN URL for a variant (D-031). v0.1 serves from
 * `storage.googleapis.com` directly; Phase 12 will replace with
 * `media.anchorcorps.com` once Cloud CDN is wired. Only this helper
 * changes; nothing else depends on the URL shape.
 */
export function variantPublicUrl(args: {
  bucket: string;
  siteId: string;
  assetId: string;
  variant: VariantName;
  hash: string;
  format: VariantFormat;
}): string {
  const { bucket, siteId, assetId, variant, hash, format } = args;
  return `https://storage.googleapis.com/${bucket}/variants/${siteId}/${assetId}-${variant}.${hash}.${format}`;
}

export function variantGcsKey(args: {
  siteId: string;
  assetId: string;
  variant: VariantName;
  hash: string;
  format: VariantFormat;
}): string {
  const { siteId, assetId, variant, hash, format } = args;
  return `variants/${siteId}/${assetId}-${variant}.${hash}.${format}`;
}
