import { z } from "zod";

/**
 * Rich-footer block (Task C2, batch 1 — structural blocks).
 *
 * A NEW block, distinct from the renderer's fixed `<footer class="ac-site-footer">`
 * shell (`src/server/render-page.tsx`) that wraps every page with a copyright
 * line — this is an author-placed page block with multi-column link groups,
 * social links, hours, and small print, for sites that want a fuller footer
 * than the site chrome provides. No existing footer *block* was found in
 * either registry (`src/blocks` or `packages/components/src/blocks`), so
 * this doesn't replace or extend anything.
 */
export const footerLinkSchema = z.object({
  label: z.string().min(1).max(60).default("Link"),
  href: z.string().max(500).default("#"),
});
export type FooterLink = z.infer<typeof footerLinkSchema>;

export const footerColumnSchema = z.object({
  heading: z.string().max(60).default(""),
  links: z.array(footerLinkSchema).max(8).default([]),
});
export type FooterColumn = z.infer<typeof footerColumnSchema>;

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "youtube",
  "tiktok",
] as const;

export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS).default("facebook"),
  href: z.string().max(500).default("#"),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

const defaultColumns: FooterColumn[] = [
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Contact", href: "#contact" },
    ],
  },
  {
    heading: "Resources",
    links: [{ label: "FAQ", href: "#faq" }],
  },
];

export const richFooterSchema = z.object({
  brand_name: z.string().max(80).default(""),
  tagline: z.string().max(200).default(""),
  columns: z.array(footerColumnSchema).max(4).default(defaultColumns),
  social_links: z.array(socialLinkSchema).max(6).default([]),
  hours: z.string().max(300).default(""),
  small_print: z.string().max(300).default(""),
});
export type RichFooterProps = z.infer<typeof richFooterSchema>;
