/**
 * D914 — default tenant favicon. Tenants have no uploaded icon asset, so
 * every tab-open showed no icon AND fired a /favicon.ico request that the
 * catch-all answered with the full ~20 KB HTML 404 page. The default mark
 * is a dot in the site's brand main color: tiny, neutral, per-site.
 *
 * The color comes from the site's brand tokens, which are schema-validated
 * at save time (src/blocks/brand-tokens.ts) — but this re-checks against a
 * conservative pattern anyway so a legacy/hand-edited row can never break
 * out of the SVG fill attribute.
 */

const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\(\s*[-0-9.,%\s/]+\s*\)|[a-zA-Z]+)$/;
const FALLBACK_COLOR = "#111111";

/** Brand main color for the favicon, defensively validated. */
export function faviconColor(tokens: Record<string, unknown> | null | undefined): string {
  const v = tokens?.["--theme-main"];
  if (typeof v === "string" && SAFE_COLOR.test(v.trim())) return v.trim();
  return FALLBACK_COLOR;
}

/** The favicon SVG document — a brand-colored dot. */
export function faviconSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="${color}"/></svg>`;
}

/** `data:` URI form for inlining as `<link rel="icon">` in the shell. */
export function faviconDataUri(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(color))}`;
}
