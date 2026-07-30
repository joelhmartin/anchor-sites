import { z } from "zod";

/**
 * Nav-bar block (Task C2, batch 1 — structural blocks).
 *
 * A NEW block — no `nav-bar`/`navbar` block existed in either registry
 * (`src/blocks` or `packages/components/src/blocks`) to extend. `variant`
 * picks the layout:
 *   - "default"  — brand left, links + optional logo right
 *   - "centered" — brand centered on top, links centered below
 *   - "cta"      — like "default" but always shows an accent button
 *                  (falls back to a placeholder label in edit mode, same
 *                  as every other CTA block in this package)
 */
export const navLinkSchema = z.object({
  label: z.string().min(1).max(40).default("Link"),
  href: z.string().max(500).default("#"),
});
export type NavLink = z.infer<typeof navLinkSchema>;

const defaultLinks: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" },
];

export const navBarSchema = z.object({
  brand_name: z.string().min(1).max(60).default("Brand"),
  logo_asset_id: z.string().default(""),
  links: z.array(navLinkSchema).max(7).default(defaultLinks),
  cta_label: z.string().max(40).default(""),
  cta_href: z.string().max(500).default("#"),
  variant: z.enum(["default", "centered", "cta"]).default("default"),
});
export type NavBarProps = z.infer<typeof navBarSchema>;
