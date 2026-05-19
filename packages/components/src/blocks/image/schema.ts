import { z } from "zod";

/**
 * P3-T3.12 — Image block schema.
 *
 * `asset_id` is the only required field; the renderer hydrates the
 * full media asset (variants etc.) via the `MediaContext` provider.
 * Anything render-time-specific (focal_point, alt, etc.) overrides the
 * asset's stored value when present.
 */
export const imageSchema = z.object({
  // Empty string is the "no asset picked yet" state; the renderer
  // shows a placeholder when this is empty so the editor can fill it.
  asset_id: z.string().default(""),
  alt: z.string().default(""),
  focal_point: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  /** Optional aspect-ratio enforced via the `<picture>` wrapper. Empty = let intrinsic ratio rule. */
  aspect_ratio: z.number().positive().optional(),
  /** Standard HTML `sizes` attribute. Empty default → no hint. */
  sizes: z.string().default(""),
});

export type ImageProps = z.infer<typeof imageSchema>;
