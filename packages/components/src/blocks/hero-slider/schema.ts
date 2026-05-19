import { z } from "zod";

export const heroSlideSchema = z.object({
  eyebrow: z.string().default(""),
  title: z.string().min(1).default("Slide headline"),
  subtitle: z.string().default(""),
  /**
   * Legacy background-image URL. Kept for backwards-compatibility through
   * the 0.x line — old hero-slider payloads still render. New content
   * should populate `image_asset_id` instead so the renderer can serve
   * variants + WebP + lazy-load (P3-T3.13).
   */
  image: z.string().default(""),
  /**
   * P3-T3.13. Preferred over `image`. References a `media_assets.id`;
   * the renderer (3.14) hydrates the asset into `MediaContext`. Empty
   * string = no asset chosen yet.
   */
  image_asset_id: z.string().default(""),
  cta_label: z.string().default(""),
  cta_href: z.string().default(""),
});
export type HeroSlide = z.infer<typeof heroSlideSchema>;

export const heroSliderSchema = z.object({
  slides: z.array(heroSlideSchema).default([
    { eyebrow: "", title: "First slide", subtitle: "", image: "", cta_label: "", cta_href: "" },
  ]),
  autoplay: z.boolean().default(false),
  interval_ms: z.number().int().min(2000).default(6000),
  align: z.enum(["left", "center"]).default("center"),
});
export type HeroSliderProps = z.infer<typeof heroSliderSchema>;
