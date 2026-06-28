import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { BlockRenderer } from "../components/BlockRenderer.js";
import type { Block } from "../blocks/types.js";
import type { ResolvedSite } from "../middleware/resolveSite.js";
import { mergeBrandTokens } from "../blocks/brand-tokens.js";
import { MediaProvider, type MediaAssetData } from "@anchorcorps/components";
import { hostnameForSlug } from "../config/domain.js";
import {
  applyTitleTemplate,
  effectiveRobots,
  normalizeTwitterHandle,
  parseSeoLoose,
  parseSiteSeoDefaultsLoose,
  type SeoFields,
} from "./seo/schema.js";
import type { OgImage } from "./seo/og-image.js";
import { organizationLd, renderJsonLd, webPageLd, webSiteLd } from "./seo/json-ld.js";

/**
 * Inline the @anchorcorps/components prebuilt CSS bundle + the inline
 * rich-text CSS into the SSR'd HTML once at module-load. The renderer
 * has no client-side hydration that would normally pick up a bundled
 * stylesheet, so we serve all block CSS via the shell's <style> tag.
 * Package CSS resolves through createRequire (workspace symlink in dev,
 * AR-installed copy in prod); the rich-text CSS lives inside this repo
 * so it resolves by absolute path off `import.meta.url`.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);
function tryReadFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
function tryReadPackageAsset(specifier: string): string {
  try {
    return readFileSync(requireFromHere.resolve(specifier), "utf8");
  } catch {
    return "";
  }
}
const PACKAGE_BLOCK_CSS = tryReadPackageAsset("@anchorcorps/components/styles.css");
const RICH_TEXT_CSS = tryReadFile(pathResolve(__dirname, "../blocks/rich-text/styles.css"));

export type PageRecord = {
  title: string;
  blocks: Block[];
  seo: Record<string, unknown>;
  /** P3-T3.5 — optional per-page override merged on top of site defaults. */
  brand_tokens_override?: Record<string, unknown> | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandTokenCss(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
}

/** Public URL path for a canonical link — leading slash, no query, no trailing slash. */
function canonicalPath(path: string | undefined): string {
  if (!path || path === "/") return "/";
  const noQuery = path.split(/[?#]/, 1)[0];
  const withSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function metaTag(attr: "name" | "property", key: string, content: string | undefined): string {
  return content ? `<meta ${attr}="${key}" content="${escapeHtml(content)}" />` : "";
}

/** Absolute canonical base for a tenant, e.g. `https://acme.sites.anchorcorps.com`. */
export function siteBaseUrl(site: ResolvedSite): string | undefined {
  try {
    return `https://${hostnameForSlug(site.slug)}`;
  } catch {
    return undefined; // unreachable for valid slugs; never block render
  }
}

/** Canonical URL for a page: explicit `seo.canonical` wins, else tenant host + path. */
export function canonicalUrl(
  site: ResolvedSite,
  seo: SeoFields,
  path: string | undefined,
): string | undefined {
  if (seo.canonical) return seo.canonical;
  const base = siteBaseUrl(site);
  return base ? `${base}${canonicalPath(path)}` : undefined;
}

/**
 * P9-T9.2/9.4 (D-049) — emit canonical, robots, Open Graph (incl. og:image),
 * and Twitter tags from a page's `seo` blob + the resolved og:image.
 */
export function renderSeoMeta(
  site: ResolvedSite,
  seo: SeoFields,
  opts: { path?: string; canonical?: string; ogImage?: OgImage } = {},
): string {
  const robots = effectiveRobots(seo);
  const robotsContent = `${robots.index ? "index" : "noindex"},${robots.follow ? "follow" : "nofollow"}`;
  const canonical = opts.canonical ?? canonicalUrl(site, seo, opts.path);

  const siteDefaults = parseSiteSeoDefaultsLoose(site.seo_defaults);
  const ogTitle = seo.og?.title || seo.title || site.display_name;
  const ogDescription = seo.og?.description || seo.description;
  const twitterSite = normalizeTwitterHandle(siteDefaults.twitterHandle);
  const img = opts.ogImage;

  return [
    `<meta name="robots" content="${robotsContent}" />`,
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : "",
    `<meta property="og:type" content="website" />`,
    metaTag("property", "og:site_name", site.display_name),
    metaTag("property", "og:title", ogTitle),
    metaTag("property", "og:description", ogDescription),
    canonical ? metaTag("property", "og:url", canonical) : "",
    img ? metaTag("property", "og:image", img.url) : "",
    img?.width ? metaTag("property", "og:image:width", String(img.width)) : "",
    img?.height ? metaTag("property", "og:image:height", String(img.height)) : "",
    img?.alt ? metaTag("property", "og:image:alt", img.alt) : "",
    metaTag("name", "twitter:card", seo.twitter?.card ?? "summary_large_image"),
    metaTag("name", "twitter:site", twitterSite),
    metaTag("name", "twitter:title", ogTitle),
    metaTag("name", "twitter:description", ogDescription),
    img ? metaTag("name", "twitter:image", img.url) : "",
  ]
    .filter(Boolean)
    .join("\n  ");
}

const SHELL_BASE_CSS = `
  body { margin: 0; }
  .ac-site-header { background: var(--theme-main, #111); color: #fff; padding: 1rem 1.5rem; }
  .ac-site-header__inner { max-width: 72rem; margin: 0 auto; }
  .ac-site-header__brand { font-weight: 600; letter-spacing: 0.01em; }
  .ac-site-main { display: block; }
  .ac-site-footer { background: #f5f5f5; color: #555; padding: 1.5rem; text-align: center; }
`;

function shell(opts: {
  site: ResolvedSite;
  title: string;
  description?: string;
  bodyHtml: string;
  status: number;
  extraCss?: string;
  /** P3-T3.5 — per-page override merged on top of site defaults. */
  pageOverride?: Record<string, unknown> | null;
  /** P9-T9.2 — extra <head> markup (SEO meta / JSON-LD), pre-escaped. */
  headExtra?: string;
}): { html: string; status: number } {
  const merged = mergeBrandTokens(opts.site.default_brand_tokens, opts.pageOverride);
  const brandStyle = brandTokenCss(merged);
  const styles = `:root { ${brandStyle} }${SHELL_BASE_CSS}${PACKAGE_BLOCK_CSS}${RICH_TEXT_CSS}${opts.extraCss ?? ""}`;

  const html = `<!doctype html>
<html lang="en" data-site-slug="${escapeHtml(opts.site.slug)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  ${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}" />` : ""}
  ${opts.headExtra ?? ""}
  <style>${styles}</style>
</head>
<body>
${opts.bodyHtml}
</body>
</html>`;

  return { html, status: opts.status };
}

function renderShellContent(site: ResolvedSite, inner: ReactElement): string {
  return renderToString(
    <div className="ac-site">
      <header className="ac-site-header">
        <div className="ac-site-header__inner">
          <span className="ac-site-header__brand">{site.display_name}</span>
        </div>
      </header>
      <main className="ac-site-main">{inner}</main>
      <footer className="ac-site-footer">
        <small>
          © {new Date().getFullYear()} {site.display_name}
        </small>
      </footer>
    </div>,
  );
}

export function renderPage(
  site: ResolvedSite,
  page: PageRecord,
  opts: {
    assets?: MediaAssetData[];
    path?: string;
    /** P9-T9.4 — resolved og:image (route loads it from the seo asset_id). */
    ogImage?: OgImage;
    /** P9-T9.4 — extra JSON-LD nodes (BlogPosting / Event) from the route. */
    extraJsonLd?: Array<Record<string, unknown>>;
  } = {},
): { html: string; status: number } {
  const pageSeo = parseSeoLoose(page.seo);
  const siteDefaults = parseSiteSeoDefaultsLoose(site.seo_defaults);
  // P9-T9.3 — page seo wins; site defaults fill the gaps (description) and the
  // title template wraps the page title ("%s — Acme Dental").
  const description = pageSeo.description ?? siteDefaults.defaultDescription;
  const seo: SeoFields = { ...pageSeo, description };
  const baseTitle = pageSeo.title || page.title || site.display_name;
  const title = applyTitleTemplate(siteDefaults.titleTemplate, baseTitle);
  const canonical = canonicalUrl(site, seo, opts.path);
  const ogImage = opts.ogImage;

  // P9-T9.4 — Organization + WebSite + WebPage baseline, plus any route-supplied
  // BlogPosting/Event nodes.
  const baseUrl = siteBaseUrl(site);
  const jsonLd = renderJsonLd([
    baseUrl ? organizationLd(site, baseUrl) : null,
    baseUrl ? webSiteLd(site, baseUrl) : null,
    webPageLd({
      name: baseTitle,
      description,
      url: canonical ?? baseUrl ?? "",
      image: ogImage?.url,
    }),
    ...(opts.extraJsonLd ?? []),
  ]);

  const bodyHtml = renderShellContent(
    site,
    // P3-T3.14 — wrap BlockRenderer in MediaProvider so the Image
    // block + hero-slider can resolve `asset_id` / `image_asset_id`
    // against the hydrated rows. Empty assets array is the no-image
    // case and renders the placeholder cleanly.
    <MediaProvider assets={opts.assets ?? []}>
      <BlockRenderer blocks={page.blocks ?? []} />
    </MediaProvider>,
  );
  const seoMeta = renderSeoMeta(site, seo, { canonical, ogImage });
  return shell({
    site,
    title,
    description: seo.description,
    bodyHtml,
    status: 200,
    pageOverride: page.brand_tokens_override ?? null,
    headExtra: jsonLd ? `${seoMeta}\n  ${jsonLd}` : seoMeta,
  });
}

export function renderNotFound(site: ResolvedSite): { html: string; status: number } {
  const bodyHtml = renderShellContent(
    site,
    <div className="ac-not-found">
      <h1>Page not found</h1>
      <p>The page you’re looking for doesn’t exist on {site.display_name}.</p>
    </div>,
  );
  const extraCss = `
    .ac-not-found { max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; }
    .ac-not-found h1 { color: var(--theme-main, #111); margin: 0 0 0.5rem; }
  `;
  return shell({
    site,
    title: `Not found — ${site.display_name}`,
    bodyHtml,
    status: 404,
    extraCss,
    // A 404 must never be indexed (P9-T9.2).
    headExtra: `<meta name="robots" content="noindex" />`,
  });
}
