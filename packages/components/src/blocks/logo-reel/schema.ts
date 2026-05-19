import { z } from "zod";

export const logoEntrySchema = z.object({
  src: z.string().min(1).default(""),
  alt: z.string().default(""),
  href: z.string().default(""),
});
export type LogoEntry = z.infer<typeof logoEntrySchema>;

export const logoReelSchema = z.object({
  heading: z.string().default(""),
  logos: z.array(logoEntrySchema).default([]),
  speed_seconds: z.number().int().min(5).max(120).default(30),
});
export type LogoReelProps = z.infer<typeof logoReelSchema>;
