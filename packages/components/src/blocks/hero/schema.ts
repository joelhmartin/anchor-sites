import { z } from "zod";

/**
 * Schema parity with Phase 1's inline `src/blocks/hero/schema.ts` so
 * existing seed data continues to render unchanged after the 2.8 swap.
 */
export const heroSchema = z.object({
  eyebrow: z.string().default(""),
  title: z.string().min(1).default("Headline goes here"),
  subtitle: z.string().default(""),
  cta_label: z.string().default("Get started"),
  cta_href: z.string().default("#"),
  align: z.enum(["left", "center"]).default("center"),
});

export type HeroProps = z.infer<typeof heroSchema>;
