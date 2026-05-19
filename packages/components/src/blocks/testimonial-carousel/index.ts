import type { BlockManifestEntry } from "../manifest.js";
import { testimonialCarouselSchema } from "./schema.js";
import { TestimonialCarousel } from "./component.js";

export const testimonialCarouselEntry: BlockManifestEntry<typeof testimonialCarouselSchema> = {
  type: "testimonial-carousel",
  schema: testimonialCarouselSchema,
  component: TestimonialCarousel,
  label: "Testimonial carousel",
  description: "Rotating quotes from clients, with optional avatar + role.",
  aiHints: "3-5 testimonials is the sweet spot. Quotes under 30 words read best.",
  category: "content",
};
