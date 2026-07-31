/**
 * Preview-only link rewriting (FINAL whole-branch review, FIX-NOW item 6).
 *
 * THE BUG. The draft preview is an `<iframe sandbox="allow-scripts">` whose
 * document URL is `/api/sites/:siteId/pages/:pageId/preview?token=…` — i.e.
 * it is served from the ADMIN origin. Template- and agent-authored markup is
 * full of ordinary site-relative links (`<a href="/about">`), which resolve
 * against that document URL. So clicking "About" inside the preview navigated
 * the frame to `https://<admin-host>/about` — the admin SPA (or its 404),
 * rendered inside the preview box, with no way back except a reload. Every
 * multi-page template shipped with this landmine.
 *
 * THE FIX, and its boundaries:
 *
 *  - PREVIEW ONLY. The rewrite is opt-in via `renderPage`'s `rewriteHref`
 *    option, which only the preview route passes. Published tenant rendering
 *    (routes/page.ts) is byte-for-byte untouched: on a real tenant host
 *    `/about` is already correct.
 *
 *  - `/​<slug>` → that sibling page's own preview URL, so navigation inside
 *    the preview stays inside the preview. `/` maps to the `home` page,
 *    mirroring the preview route's own path↔slug mapping.
 *
 *  - A slug with no matching page becomes inert (`#`) rather than being left
 *    to escape to the admin origin. An agent-authored link to a page that
 *    doesn't exist yet is common; a dead-but-harmless link is the right
 *    failure mode.
 *
 *  - Only genuinely site-relative values are touched: `//host/x`
 *    (protocol-relative), `https://…`, `mailto:`, `tel:`, and bare `#anchor`
 *    are all left exactly as authored — in-page anchors in particular must
 *    keep working.
 *
 *  - QUERY PROPAGATION. The rewritten URL carries the SAME query params the
 *    current preview was loaded with (`token` — the iframe cannot set
 *    headers, so it is the only way the navigation authenticates — plus the
 *    cache-busting `v`), with two deliberate exceptions: `edit` and
 *    `bridge`. A bridge token identifies ONE inline-editor session bound to
 *    ONE pageId (`createInlineEditor({ siteId, pageId })` closes over it), so
 *    carrying it into a navigation to a DIFFERENT page would hand the overlay
 *    a session that saves to the wrong page — the exact class of silent data
 *    loss `SitePreviewPanel` already pins `displayed.pageId` for a whole edit
 *    session to avoid. Navigations therefore always land in plain preview.
 *
 *  - EDIT MODE IS REWRITTEN TOO (verified, not assumed). The inline editor
 *    never reads an anchor's `href` from the DOM: the link chip's starting
 *    value comes from `bootData.urls`, built server-side from the block's
 *    PROPS (`buildUrlValues` in admin-pages.ts), and `links.ts`'s
 *    `applyField` only WRITES an href back. So rewriting rendered hrefs
 *    cannot change what the LinkPopover shows or saves. Leaving edit mode
 *    un-rewritten would have been strictly worse: the overlay does not
 *    preventDefault on anchor clicks, so a stray click would still have
 *    thrown the frame onto the admin origin — and taken the live edit
 *    session with it.
 */

export type PreviewPageRef = { id: string; slug: string };

/** Query params that must NEVER ride along into a rewritten navigation. */
const NON_PROPAGATED_PARAMS = new Set(["edit", "bridge"]);

/**
 * Build the `href` → preview-URL resolver for one preview render.
 *
 * Returns `null` for "no matching page" (the caller makes it inert). Only
 * ever called with values that already start with a single `/`.
 */
export function buildPreviewHrefResolver(opts: {
  siteId: string;
  pages: PreviewPageRef[];
  /** `req.query` of the preview request whose HTML is being rewritten. */
  query?: Record<string, unknown>;
}): (href: string) => string | null {
  const bySlug = new Map(opts.pages.map((p) => [p.slug, p.id]));

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (NON_PROPAGATED_PARAMS.has(key)) continue;
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") params.append(key, v);
  }
  const qs = params.toString() ? `?${params.toString()}` : "";

  return (href: string): string | null => {
    // Split off the fragment (kept — an in-page anchor on the target page is
    // still meaningful) and any query string (dropped — a site-relative query
    // means nothing to the preview route, and keeping it would collide with
    // the token/cache-buster params above).
    const hashIndex = href.indexOf("#");
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    let path = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const queryIndex = path.indexOf("?");
    if (queryIndex >= 0) path = path.slice(0, queryIndex);

    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    const slug = trimmed === "" ? "home" : trimmed;
    const pageId = bySlug.get(slug);
    if (!pageId) return null;
    return `/api/sites/${opts.siteId}/pages/${pageId}/preview${qs}${hash}`;
  };
}

/**
 * Template-preview flavor of the resolver above (W1.1 template preview):
 * `/​<slug>` → that TEMPLATE page's own preview URL, so navigation inside the
 * template preview stays inside it. Template pages are addressed by slug (no
 * per-site page ids exist), and the same query-propagation rules apply —
 * `token` rides along (the iframe's only credential channel), `edit`/`bridge`
 * never do (template preview has no edit mode at all).
 */
export function buildTemplatePreviewHrefResolver(opts: {
  templateId: string;
  pages: { slug: string }[];
  /** `req.query` of the preview request whose HTML is being rewritten. */
  query?: Record<string, unknown>;
}): (href: string) => string | null {
  const slugs = new Set(opts.pages.map((p) => p.slug));

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (NON_PROPAGATED_PARAMS.has(key)) continue;
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") params.append(key, v);
  }
  const qs = params.toString() ? `?${params.toString()}` : "";

  return (href: string): string | null => {
    const hashIndex = href.indexOf("#");
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    let path = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const queryIndex = path.indexOf("?");
    if (queryIndex >= 0) path = path.slice(0, queryIndex);

    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    const slug = trimmed === "" ? "home" : trimmed;
    if (!slugs.has(slug)) return null;
    return `/api/templates/${opts.templateId}/preview/${slug}${qs}${hash}`;
  };
}

/**
 * `href="/x"` → `href="<resolved>"` across a rendered HTML fragment.
 *
 * Deliberately a string pass over the BODY fragment (renderPage applies it to
 * `bodyHtml`, before the shell wraps it) rather than a DOM parse: the body is
 * React's own `renderToString` output, so quoting is uniform and predictable,
 * and no head content (canonical link, JSON-LD, the nonce'd overlay script)
 * is ever in scope.
 *
 * The double-slash guard is load-bearing: `href="//evil.example"` is
 * protocol-relative, NOT site-relative, and rewriting it would change where a
 * link points.
 */
export function rewriteSiteRelativeHrefs(
  html: string,
  resolve: (href: string) => string | null,
): string {
  return html.replace(/href=(["'])(\/[^"'>]*)\1/gi, (whole, quote: string, value: string) => {
    if (value.startsWith("//")) return whole;
    const resolved = resolve(value);
    return `href=${quote}${escapeAttr(resolved ?? "#")}${quote}`;
  });
}

/** Attribute-escape a URL we generated (its `&` separators especially). */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
