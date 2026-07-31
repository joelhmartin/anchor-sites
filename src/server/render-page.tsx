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
import { EditModeProvider, MediaProvider, type MediaAssetData } from "@anchorcorps/components";
import { hostnameForSlug } from "../config/domain.js";
import { analyticsScriptTag } from "./analytics.js";
import { OVERLAY_CSS } from "./preview-overlay.js";
import { rewriteSiteRelativeHrefs } from "./preview-links.js";
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

export { analyticsScriptTag } from "./analytics.js";

/**
 * P11-T11.2 (D-052) — Builds the CTM loader script tag for a given account ID.
 * Attribute-escaped so the account ID cannot break out of the data attribute.
 * Emitted BEFORE headExtra in shell() so CTM runs before the page bundle.
 */
export function ctmScriptTag(accountId: string): string {
  const safeId = escapeHtml(accountId);
  return `<script src="https://cdn.calltracking.com/call-tracking.min.js" async data-ctm-account-id="${safeId}"></script>`;
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
  opts: { path?: string; canonical?: string; ogImage?: OgImage; title?: string } = {},
): string {
  const robots = effectiveRobots(seo);
  const robotsContent = `${robots.index ? "index" : "noindex"},${robots.follow ? "follow" : "nofollow"}`;
  const canonical = opts.canonical ?? canonicalUrl(site, seo, opts.path);

  const siteDefaults = parseSiteSeoDefaultsLoose(site.seo_defaults);
  // Prefer the page's own (content) title over the tenant name so a post with
  // an empty SEO blob still shares as its title, not the site name.
  const ogTitle = seo.og?.title || seo.title || opts.title || site.display_name;
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
    // A large-image card with no image renders blank on X — fall back to a
    // summary card unless an explicit card or an og:image is present.
    metaTag("name", "twitter:card", seo.twitter?.card ?? (img ? "summary_large_image" : "summary")),
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

  const ctmTag = opts.site.ctm_account_id ? `\n  ${ctmScriptTag(opts.site.ctm_account_id)}` : "";

  const analyticsBaseUrl = process.env.ANALYTICS_BASE_URL;
  const analyticsProvider = process.env.ANALYTICS_PROVIDER ?? "plausible";
  let canonicalHost: string;
  try { canonicalHost = hostnameForSlug(opts.site.slug); } catch { canonicalHost = opts.site.slug; }
  const analyticsTag =
    analyticsBaseUrl && !opts.site.analytics_disabled
      ? `\n  ${analyticsScriptTag(canonicalHost, analyticsBaseUrl, analyticsProvider)}`
      : "";

  const webVitalsEndpoint = process.env.WEB_VITALS_ENDPOINT;
  const vitalsTag = webVitalsEndpoint
    ? `\n  <script>(function(){` +
      `var ep=${JSON.stringify(webVitalsEndpoint)};` +
      `function rep(m){try{fetch(ep,{method:"POST",` +
      `headers:{"content-type":"application/json"},` +
      `body:JSON.stringify({name:m.name,value:m.value,id:m.id,delta:m.delta}),` +
      `keepalive:true});}catch(_){}}` +
      `var s=document.createElement("script");` +
      `s.src="https://unpkg.com/web-vitals/dist/web-vitals.iife.js";` +
      `s.onload=function(){["onLCP","onCLS","onFCP","onTTFB","onINP"].forEach(function(f){` +
      `if(webVitals[f])webVitals[f](rep);});};` +
      `document.head.appendChild(s);})()</script>`
    : "";

  const html = `<!doctype html>
<html lang="en" data-site-slug="${escapeHtml(opts.site.slug)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  ${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}" />` : ""}${ctmTag}${analyticsTag}${vitalsTag}
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
    /**
     * Inline Editing Task 4 — when set, the preview route renders with block
     * markers (`data-block-id` / `data-field`), a nonce-scoped inline overlay
     * script, and its boot payload. Absent in every non-preview render path.
     */
    editable?: { overlayJs: string; nonce: string; bootData: object };
    /**
     * FINAL whole-branch review, FIX-NOW item 6 — PREVIEW ONLY. When set,
     * every site-relative `href` in the rendered BODY is passed through this
     * resolver (`null` → inert `#`). Only the draft-preview route supplies
     * it; published tenant rendering never does, so its output is unchanged.
     * See `preview-links.ts` for why this exists and what it deliberately
     * does not touch.
     */
    rewriteHref?: (href: string) => string | null;
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

  // P3-T3.14 — wrap BlockRenderer in MediaProvider so the Image
  // block + hero-slider can resolve `asset_id` / `image_asset_id`
  // against the hydrated rows. Empty assets array is the no-image
  // case and renders the placeholder cleanly.
  const blockTree = (
    <MediaProvider assets={opts.assets ?? []}>
      <BlockRenderer blocks={page.blocks ?? []} editable={Boolean(opts.editable)} />
    </MediaProvider>
  );
  // Inline Editing Task 4 — `EditModeProvider` flips `Editable` (inside
  // `@anchorcorps/components`) into always-rendered/data-field mode; the
  // plain render path never touches this, so byte-behavior is unchanged
  // when `opts.editable` is absent.
  const renderedBody = renderShellContent(
    site,
    opts.editable ? <EditModeProvider>{blockTree}</EditModeProvider> : blockTree,
  );
  // Item 6 — applied to the BODY only (never the head's canonical link or
  // JSON-LD, never the overlay boot script), and only when the preview route
  // asked for it.
  const bodyHtml = opts.rewriteHref
    ? rewriteSiteRelativeHrefs(renderedBody, opts.rewriteHref)
    : renderedBody;
  const seoMeta = renderSeoMeta(site, seo, { canonical, ogImage, title: baseTitle });
  // Inline Editing Task 4 (exact, per brief) — the boot script carries the
  // overlay's boot payload. `\u003c` escapes any `<` a bootData string might
  // contain so it can never form a `</script>` breakout.
  const editHead = opts.editable
    ? `\n<script nonce="${opts.editable.nonce}">window.__AC_EDIT_BOOT__ = ${JSON.stringify(opts.editable.bootData).replace(/</g, "\\u003c")};\n${opts.editable.overlayJs}</script>`
    : "";
  return shell({
    site,
    title,
    description: seo.description,
    bodyHtml,
    status: 200,
    pageOverride: page.brand_tokens_override ?? null,
    headExtra: jsonLd ? `${seoMeta}\n  ${jsonLd}${editHead}` : `${seoMeta}${editHead}`,
    extraCss: opts.editable ? OVERLAY_CSS : undefined,
  });
}

/**
 * D904 — a provisioned site with zero published home is a deliberate state,
 * not an error: the live URL is handed to the operator the moment
 * provisioning is announced, well before first publish (and W1.3 makes
 * "unpublished" a real state again). Branded (site shell + brand tokens),
 * minimal, noindex, and HTTP 200 — the site exists; there is simply nothing
 * published yet.
 */
export function renderComingSoon(site: ResolvedSite): { html: string; status: number } {
  const bodyHtml = renderShellContent(
    site,
    <div className="ac-coming-soon">
      <h1>{site.display_name}</h1>
      <p>Coming soon.</p>
      <p className="ac-coming-soon__sub">This site is being prepared — check back shortly.</p>
    </div>,
  );
  const extraCss = `
    .ac-coming-soon { max-width: 40rem; margin: 6rem auto; padding: 0 1.5rem; text-align: center; }
    .ac-coming-soon h1 { color: var(--theme-main, #111); margin: 0 0 0.75rem; }
    .ac-coming-soon p { margin: 0 0 0.25rem; font-size: 1.125rem; }
    .ac-coming-soon__sub { color: #777; font-size: 0.875rem; }
  `;
  return shell({
    site,
    title: `${site.display_name} — coming soon`,
    bodyHtml,
    status: 200,
    extraCss,
    // Never index a placeholder.
    headExtra: `<meta name="robots" content="noindex" />`,
  });
}

/**
 * D700 — branded confirmation for a stored lead. Template `crm_form`s are
 * plain HTML posts (published pages ship no client JS), so this page IS the
 * post-submit navigation target. `backHref` is always site-relative (the
 * leads route clamps it to a leading "/"), pointing back at the page the
 * visitor submitted from.
 */
export function renderLeadThanks(
  site: ResolvedSite,
  opts: { backHref?: string } = {},
): { html: string; status: number } {
  const backHref = opts.backHref ?? "/";
  const bodyHtml = renderShellContent(
    site,
    <div className="ac-lead-thanks">
      <h1>Thank you!</h1>
      <p>Your message has been received by {site.display_name}.</p>
      <p className="ac-lead-thanks__sub">We&rsquo;ll be in touch as soon as possible.</p>
      <p>
        <a className="ac-lead-thanks__back" href={backHref}>
          &larr; Back to the site
        </a>
      </p>
    </div>,
  );
  const extraCss = `
    .ac-lead-thanks { max-width: 40rem; margin: 6rem auto; padding: 0 1.5rem; text-align: center; }
    .ac-lead-thanks h1 { color: var(--theme-main, #111); margin: 0 0 0.75rem; }
    .ac-lead-thanks p { margin: 0 0 0.5rem; font-size: 1.125rem; }
    .ac-lead-thanks__sub { color: #777; font-size: 0.875rem; }
    .ac-lead-thanks__back { color: var(--theme-accent, var(--theme-main, #111)); text-decoration: underline; }
  `;
  return shell({
    site,
    title: `Thank you — ${site.display_name}`,
    bodyHtml,
    status: 200,
    extraCss,
    // A confirmation page must never be indexed.
    headExtra: `<meta name="robots" content="noindex" />`,
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
