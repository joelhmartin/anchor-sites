import { z } from "zod";

export const faqItemSchema = z.object({
  question: z.string().min(1).default("Question goes here"),
  answer: z.string().min(1).default("Answer goes here."),
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const faqAccordionSchema = z.object({
  heading: z.string().default("Frequently asked questions"),
  items: z.array(faqItemSchema).default([]),
  /** Whether more than one item can be open at once. */
  multiple: z.boolean().default(false),
});
export type FaqAccordionProps = z.infer<typeof faqAccordionSchema>;
