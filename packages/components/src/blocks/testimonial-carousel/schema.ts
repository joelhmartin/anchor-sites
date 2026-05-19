import { z } from "zod";

export const testimonialSchema = z.object({
  quote: z.string().min(1).default("Working with them changed our business."),
  author: z.string().min(1).default("Anonymous"),
  role: z.string().default(""),
  avatar: z.string().default(""),
});
export type Testimonial = z.infer<typeof testimonialSchema>;

export const testimonialCarouselSchema = z.object({
  heading: z.string().default("What clients say"),
  items: z.array(testimonialSchema).default([
    { quote: "Working with them changed our business.", author: "Sample Client", role: "CEO", avatar: "" },
  ]),
  autoplay: z.boolean().default(false),
  interval_ms: z.number().int().min(2000).default(5000),
});
export type TestimonialCarouselProps = z.infer<typeof testimonialCarouselSchema>;
