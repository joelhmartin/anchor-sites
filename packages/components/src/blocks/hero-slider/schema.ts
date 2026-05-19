import { z } from "zod";

export const heroSlideSchema = z.object({
  eyebrow: z.string().default(""),
  title: z.string().min(1).default("Slide headline"),
  subtitle: z.string().default(""),
  image: z.string().default(""),
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
