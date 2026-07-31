import { z } from "zod";

/**
 * Feature-grid block (Task C2, batch 1 — structural blocks).
 *
 * `icon` is dual-purpose by design: it accepts either a curated icon-name
 * key (rendered as a hand-rolled SVG glyph — see `./icons.tsx`) or a raw
 * emoji/short string, which the renderer falls back to printing verbatim
 * when the name isn't in the curated set. No icon library is pulled into
 * this package (matches the rest of `packages/components`, which has zero
 * icon-lib usage — see `src/admin/components/agent-chat/icons.tsx`'s
 * precedent for hand-rolled SVGs over a dependency).
 */
export const featureItemSchema = z.object({
  // D1202: the curated vocabulary is published here so it reaches every
  // author — the AI catalog derives its JSON schema from this field via
  // zod-to-json-schema, which carries `.describe()` through as `description`.
  // A test asserts this list stays in sync with CURATED_ICONS (./icons.tsx).
  icon: z
    .string()
    .max(40)
    .default("sparkles")
    .describe(
      'Curated icon name — one of: "bolt", "shield", "sparkles", "heart", "clock", "users", "award", "target", "check", "star", "book", "sun", "home", "dollar", "briefcase" — or a literal emoji/short text (e.g. "🚀", "01") rendered verbatim. Any other word renders as a neutral dot, so prefer a curated name.',
    ),
  title: z.string().min(1).max(80).default("Feature title"),
  body: z.string().max(300).default(""),
});
export type FeatureItem = z.infer<typeof featureItemSchema>;

const defaultItems: FeatureItem[] = [
  { icon: "bolt", title: "Fast to launch", body: "Get a polished site live in days, not months." },
  { icon: "shield", title: "Built to last", body: "Secure, accessible, and maintained for you." },
  { icon: "sparkles", title: "Looks the part", body: "Real typographic hierarchy, no template feel." },
];

export const featureGridSchema = z.object({
  eyebrow: z.string().max(80).default(""),
  heading: z.string().max(120).default(""),
  items: z.array(featureItemSchema).min(3).max(6).default(defaultItems),
});
export type FeatureGridProps = z.infer<typeof featureGridSchema>;
