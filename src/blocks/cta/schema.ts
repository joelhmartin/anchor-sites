import { z } from "zod";

export const ctaSchema = z.object({
  heading: z.string().min(1).default("Ready to get started?"),
  body: z.string().default(""),
  button_label: z.string().min(1).default("Contact us"),
  button_href: z.string().default("#contact"),
  variant: z.enum(["primary", "muted"]).default("primary"),
});

export type CtaProps = z.infer<typeof ctaSchema>;
