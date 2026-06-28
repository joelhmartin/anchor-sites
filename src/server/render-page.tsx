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
import { effectiveRobots, parseSeoLoose, type SeoFields } from "./seo/schema.js";

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

/**
 * P9-T9.2 (D-049) — emit canonical, robots, Open Graph and Twitter tags from a
 * page's `seo` blob. `og:image` (a media `asset_id`) and JSON-LD are layered on
 * in 9.4. Canonical defaults to the page's canonical tenant URL unless the
 * operator set an explicit `seo.canonical`.
 */
export function renderSeoMeta(
  site: ResolvedSite,
  seo: SeoFields,
  opts: { path?: string } = {},
): string {
  const robots = effectiveRobots(seo);
  const robotsContent = `${robots.index ? "index" : "noindex"},${robots.follow ? "follow" : "nofollow"}`;

  let canonical = seo.canonical;
  if (!canonical) {
    try {
      canonical = `https://${hostnameForSlug(site.slug)}${canonicalPath(opts.path)}`;
    } catch {
      canonical = undefined; // unreachable for valid slugs; never block render
    }
  }

  const ogTitle = seo.og?.title || seo.title || site.display_name;
  const ogDescription = seo.og?.description || seo.description;

  return [
    `<meta name="robots" content="${robotsContent}" />`,
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : "",
    `<meta property="og:type" content="website" />`,
    metaTag("property", "og:site_name", site.display_name),
    metaTag("property", "og:title", ogTitle),
    metaTag("property", "og:description", ogDescription),
    canonical ? metaTag("property", "og:url", canonical) : "",
    metaTag("name", "twitter:card", seo.twitter?.card ?? "summary_large_image"),
    metaTag("name", "twitter:title", ogTitle),
    metaTag("name", "twitter:description", ogDescription),
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
  opts: { assets?: MediaAssetData[]; path?: string } = {},
): { html: string; status: number } {
  const seo = parseSeoLoose(page.seo);
  const title = seo.title || page.title || site.display_name;
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
  return shell({
    site,
    title,
    description: seo.description,
    bodyHtml,
    status: 200,
    pageOverride: page.brand_tokens_override ?? null,
    headExtra: renderSeoMeta(site, seo, { path: opts.path }),
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
