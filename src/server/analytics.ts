/**
 * P12-T12.2 (D-054) — Analytics script tag builder.
 *
 * Extracted into its own module so it can be unit-tested without pulling in
 * the heavy @anchorcorps/components dependency (render-page.tsx does that).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds a Plausible CE or Umami script tag.
 * Both `domain` and `baseUrl` are HTML-escaped to prevent attribute injection.
 *
 * @param domain  The site's public hostname used as the analytics site key.
 * @param baseUrl The analytics instance base URL (e.g. https://analytics.anchorcorps.com).
 * @param provider `"plausible"` (default) or `"umami"`.
 */
export function analyticsScriptTag(
  domain: string,
  baseUrl: string,
  provider: string = "plausible",
): string {
  const d = escapeHtml(domain);
  const b = escapeHtml(baseUrl);
  if (provider === "umami") {
    return `<script defer src="${b}/script.js" data-website-id="${d}"></script>`;
  }
  return `<script defer src="${b}/js/script.js" data-domain="${d}"></script>`;
}
