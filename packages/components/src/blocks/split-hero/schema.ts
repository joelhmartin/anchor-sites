import { z } from "zod";

/**
 * Split-hero block (Task C2, batch 1 — structural blocks).
 *
 * A two-column hero: copy on one side, a supporting image on the other.
 * `variant` picks which side the image renders on; everything else mirrors
 * the plain `hero` block's field names (eyebrow/heading/body) plus a real
 * `image_asset_id` (classified "image" by `buildEditableFieldMap` per the
 * `/asset_id$/` naming rule) and a second, optional CTA.
 */
export const splitHeroSchema = z.object({
  eyebrow: z.string().max(80).default(""),
  heading: z.string().min(1).max(120).default("A headline that earns the scroll"),
  body: z.string().max(500).default(""),
  primary_cta_label: z.string().max(40).default("Get started"),
  primary_cta_href: z.string().max(500).default("#"),
  secondary_cta_label: z.string().max(40).default(""),
  secondary_cta_href: z.string().max(500).default("#"),
  image_asset_id: z.string().default(""),
  image_alt: z.string().max(200).default(""),
  variant: z.enum(["image-left", "image-right"]).default("image-right"),
});

export type SplitHeroProps = z.infer<typeof splitHeroSchema>;
