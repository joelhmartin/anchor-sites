import { z } from "zod";

/**
 * Stats-band block (Task C2, batch 1 — structural blocks).
 *
 * A full-bleed accent-colored band with 2-5 stat callouts. `value` stays a
 * free-text string (not a number) so authors can include "+", "%", "K",
 * currency symbols, etc. without the renderer trying to format anything.
 */
export const statItemSchema = z.object({
  value: z.string().min(1).max(20).default("100+"),
  label: z.string().min(1).max(60).default("Stat label"),
});
export type StatItem = z.infer<typeof statItemSchema>;

const defaultStats: StatItem[] = [
  { value: "500+", label: "Projects shipped" },
  { value: "98%", label: "Client retention" },
];

export const statsBandSchema = z.object({
  heading: z.string().max(120).default(""),
  stats: z.array(statItemSchema).min(2).max(5).default(defaultStats),
});
export type StatsBandProps = z.infer<typeof statsBandSchema>;
