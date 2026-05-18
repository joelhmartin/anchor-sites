/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SITE CONFIG — Single source of truth for all site-wide data.
 *
 * Every component that needs business info, logos, contact details,
 * or social links should import from here. When spinning up a new
 * site from this codebase, this is the primary file to update.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Facebook, Instagram } from "lucide-react";

// ── Business ─────────────────────────────────────────────────────────────────

export const BUSINESS = {
  name:        "Company Name",
  shortName:   "Company",
  tagline:     "Your Tagline Goes Here",
  description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  city:        "City",
  state:       "State",
  location:    "City, ST",
  address:     "City, ST",
  founded:     2020,
};

// ── Contact ──────────────────────────────────────────────────────────────────

export const CONTACT = {
  phone:       "(555) 123-4567",
  phoneHref:   "tel:+15551234567",
  email:       "hello@example.com",
  emailHref:   "mailto:hello@example.com",
  hours:       "Mon–Fri, 9:00 AM – 5:00 PM",
};

// ── Links ────────────────────────────────────────────────────────────────────

export const LINKS = {
  googleMaps:      "#",
  googleMapsEmbed: "#",
  googleReview:    "#",
};

// ── Social ───────────────────────────────────────────────────────────────────

export const SOCIALS = [
  {
    label: "Facebook",
    icon:  Facebook,
    href:  "#",
  },
  {
    label: "Instagram",
    icon:  Instagram,
    href:  "#",
  },
];

// ── Logos ─────────────────────────────────────────────────────────────────────
// All paths relative to /public. Add stacked variants here when available.

export const LOGOS = {
  icon:              "/images/logo/logo-icon.svg",

  // Horizontal
  horizontalBlack:   "/images/logo/logo-horizontal-black.svg",
  horizontalWhite:   "/images/logo/logo-horizontal-white.svg",

  // Stacked (add files to /public/images/logo/ when ready)
  stackedBlack:      null,
  stackedWhite:      null,
};

// ── Services ─────────────────────────────────────────────────────────────────
// Drives nav links, footer links, contact form options, and service tabs.
// Update labels and routes here — components will pick up changes automatically.

export const SERVICES_NAV = [
  { label: "Service One",   to: "/services/service-one" },
  { label: "Service Two",   to: "/services/service-two" },
  { label: "Service Three", to: "/services/service-three" },
  { label: "Service Four",  to: "/services/service-four" },
  { label: "Service Five",  to: "/services/service-five" },
];

// ── Content Types & URL Structure ─────────────────────────────────────────────
// Controls URL prefixes, pagination, and per-page counts for all content types.
// When migrating from WordPress or another CMS, update these to match the
// existing URL structure so you don't lose SEO weight or create orphaned pages.
//
// Examples:
//   WordPress default:    prefix: "/blog",   pagination: "/page"
//   WordPress custom:     prefix: "",         pagination: "/page"    (posts at root)
//   Custom slug:          prefix: "/articles", pagination: "/page"
//   WP-style single:     prefix: "/post"     (single posts at /post/my-slug)

export const CONTENT = {
  blog: {
    // List page path — the main blog index
    listPath:       "/blog",
    // Single post prefix — posts will be at {prefix}/{slug}
    // Change to "/post" or "" to match an existing WordPress structure
    prefix:         "/blog",
    // Pagination URL segment — appended to listPath: /blog/page/2
    paginationSlug: "/page",
    // Items per page (set to 0 or Infinity to disable pagination)
    perPage:        6,
    // Label used in nav/breadcrumbs
    label:          "Blog",
  },
  events: {
    listPath:       "/events",
    prefix:         "/events",
    paginationSlug: "/page",
    perPage:        9,
    label:          "Events",
  },
};

// Helper: build a post URL from slug
export const blogUrl   = (slug) => `${CONTENT.blog.prefix}/${slug}`;
export const eventUrl  = (slug) => `${CONTENT.events.prefix}/${slug}`;
// Helper: build a pagination URL
export const blogPageUrl  = (num) => num <= 1 ? CONTENT.blog.listPath : `${CONTENT.blog.listPath}${CONTENT.blog.paginationSlug}/${num}`;
export const eventPageUrl = (num) => num <= 1 ? CONTENT.events.listPath : `${CONTENT.events.listPath}${CONTENT.events.paginationSlug}/${num}`;

// ── SEO Defaults ─────────────────────────────────────────────────────────────

export const SEO = {
  titleTemplate: `%s | ${BUSINESS.name}`,
  defaultTitle:  `${BUSINESS.name} — ${BUSINESS.tagline}`,
  defaultDesc:   BUSINESS.description,
  url:           "https://example.com",
  ogImage:       null,
};

// ── Legacy compat — flat SITE export used by older components ────────────────

export const SITE = {
  ...BUSINESS,
  ...CONTACT,
  ...LINKS,
  socials: SOCIALS,
  logos: LOGOS,
};
