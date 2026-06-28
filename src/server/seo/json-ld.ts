import type { ResolvedSite } from "../../middleware/resolveSite.js";

/**
 * JSON-LD structured data (P9-T9.4, D-049). Organization + WebSite baseline on
 * every page; WebPage per page; BlogPosting on posts; Event on events. Emitted
 * as one `<script type="application/ld+json">` per node.
 *
 * Operator-approved richness: baseline + BlogPosting + Event.
 */

type Json = Record<string, unknown>;

export function organizationLd(site: ResolvedSite, siteUrl: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.display_name,
    url: siteUrl,
  };
}

export function webSiteLd(site: ResolvedSite, siteUrl: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.display_name,
    url: siteUrl,
  };
}

export function webPageLd(opts: {
  name: string;
  description?: string;
  url: string;
  image?: string;
}): Json {
  const ld: Json = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    url: opts.url,
  };
  if (opts.description) ld.description = opts.description;
  if (opts.image) ld.image = opts.image;
  return ld;
}

export function blogPostingLd(opts: {
  site: ResolvedSite;
  headline: string;
  description?: string;
  url: string;
  image?: string;
  datePublished?: string | null;
  authorName?: string | null;
}): Json {
  const ld: Json = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: opts.headline,
    url: opts.url,
    mainEntityOfPage: opts.url,
    publisher: { "@type": "Organization", name: opts.site.display_name },
  };
  if (opts.description) ld.description = opts.description;
  if (opts.image) ld.image = opts.image;
  if (opts.datePublished) ld.datePublished = opts.datePublished;
  if (opts.authorName) ld.author = { "@type": "Person", name: opts.authorName };
  return ld;
}

export function eventLd(opts: {
  name: string;
  description?: string;
  url: string;
  image?: string;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
}): Json {
  const ld: Json = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: opts.name,
    url: opts.url,
  };
  if (opts.description) ld.description = opts.description;
  if (opts.image) ld.image = opts.image;
  if (opts.startDate) ld.startDate = opts.startDate;
  if (opts.endDate) ld.endDate = opts.endDate;
  if (opts.location) {
    ld.location = { "@type": "Place", name: opts.location };
  }
  return ld;
}

/**
 * Serialize JSON-LD nodes to `<script>` tags. `<` is escaped to `<` so a
 * stray `</script>` (or any `<`) in the data can never break out of the script
 * element — the standard XSS-safe JSON-in-HTML encoding.
 */
export function renderJsonLd(nodes: Array<Json | null | undefined>): string {
  return nodes
    .filter((n): n is Json => Boolean(n))
    .map(
      (n) =>
        `<script type="application/ld+json">${JSON.stringify(n).replace(/</g, "\\u003c")}</script>`,
    )
    .join("\n  ");
}
