/**
 * P12-T12.5 (D-056) — Content Security Policy builder.
 *
 * Assembles the helmet contentSecurityPolicy directives object from env vars.
 * Unit-tested so directives are verifiable without starting the server.
 *
 * NOTE: 'unsafe-inline' in script-src is a known gap while legacy inline
 * blocks exist. Migration path: nonce-per-request in a future phase (replace
 * inline blocks with external scripts and inject a nonce via res.locals).
 */

import { createHash } from "node:crypto";
import { CAROUSEL_ISLAND_JS } from "@anchorcorps/components";

/**
 * D1200 (spec: docs/superpowers/specs/2026-07-31-published-page-interactivity.md)
 * — CSP hash-source for the carousel enhancement island the
 * `@anchorcorps/components` Carousel primitive inlines into its own SSR
 * output. Preview routes (draft preview, template preview) interpolate this
 * into their per-response `script-src` so the island runs there exactly as
 * it does on live pages (which already allow it via 'unsafe-inline').
 * Computed from the package's exported constant at module load so the hash
 * can never drift from the script bytes.
 *
 * Deliberately NOT added to `buildCsp` below: a hash/nonce in script-src
 * makes browsers ignore 'unsafe-inline', which would silently break the
 * shell's other inline scripts (analytics, web-vitals, edit boot).
 */
export const CAROUSEL_ISLAND_CSP_HASH = `'sha256-${createHash("sha256")
  .update(CAROUSEL_ISLAND_JS, "utf8")
  .digest("base64")}'`;

/**
 * D306 — the plain (non-edit) draft preview injects this tiny notifier so the
 * workspace shell can learn which page the frame is actually showing after an
 * in-frame link click (the sandbox is opaque-origin, so the parent can read
 * neither the frame's URL nor its DOM). It reads the page id from its own
 * `data-page-id` attribute (constant script BYTES → stable hash) and
 * postMessages it to the parent once, on load. The Studio side
 * (`SitePreviewPanel`) validates `event.source`, the shape, and that the id
 * is a real page before syncing the switcher. Edit mode uses the separate
 * authenticated bridge instead and does NOT inject this.
 */
export const PREVIEW_NAV_NOTIFIER_JS =
  `(function(){try{var s=document.currentScript;var id=s?s.getAttribute('data-page-id'):null;` +
  `if(id&&window.parent&&window.parent!==window){window.parent.postMessage({source:'ac-preview',type:'nav',pageId:id},'*');}}catch(e){}})();`;

export const PREVIEW_NAV_NOTIFIER_CSP_HASH = `'sha256-${createHash("sha256")
  .update(PREVIEW_NAV_NOTIFIER_JS, "utf8")
  .digest("base64")}'`;

function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * D810 (W2-SEC) — the STUDIO host's own policy, split from the tenant one.
 *
 * The admin SPA is a plain Vite build: dist/index.html carries ZERO inline
 * scripts (one external module <script src>, one stylesheet), so the studio
 * origin needs neither 'unsafe-inline' nor a nonce in script-src — `'self'`
 * alone is both sufficient and stricter than the nonce migration the header
 * comment above sketches (prod serves the static file via sendFile, so a
 * per-request nonce could not be injected anyway). unpkg.com and
 * cdn.calltracking.com are tenant-page concerns and never load on this host.
 *
 * Dev is the one exception: @vitejs/plugin-react injects a genuine inline
 * react-refresh preamble into the transformed index.html, and HMR needs a
 * websocket — both gated on NODE_ENV !== "production", exactly mirroring
 * when src/server/index.ts mounts Vite middleware.
 *
 * The workspace/template preview iframes are unaffected: those routes set
 * their own per-response CSP via res.setHeader AFTER helmet ran (see
 * admin-pages.ts / templates.ts — incl. CAROUSEL_ISLAND_CSP_HASH), which
 * replaces whatever host policy applied.
 */
export function buildStudioCsp(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const sentryOrigin = env.SENTRY_DSN ? originFromUrl(env.SENTRY_DSN) : null;
  const dev = env.NODE_ENV !== "production";

  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    // fonts.googleapis.com serves the @font-face stylesheet linked in
    // index.html; MUI/inline React styles need style-src 'unsafe-inline'.
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    // blob: for upload previews (URL.createObjectURL); GCS for media-library
    // thumbnails; Pixabay for the stock-image search previews
    // (image-sources.tsx renders hit.preview directly).
    imgSrc: [
      "'self'",
      "data:",
      "blob:",
      "storage.googleapis.com",
      "https://cdn.pixabay.com",
      "https://pixabay.com",
    ],
    connectSrc: ["'self'", ...(sentryOrigin ? [sentryOrigin] : []), ...(dev ? ["ws:", "wss:"] : [])],
    // SitePreviewPanel embeds the app's OWN same-origin preview routes.
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
  };
}

export function buildCsp(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const analyticsOrigin = env.ANALYTICS_BASE_URL ? originFromUrl(env.ANALYTICS_BASE_URL) : null;
  const sentryOrigin = env.SENTRY_DSN ? originFromUrl(env.SENTRY_DSN) : null;
  const vitalsOrigin = env.WEB_VITALS_ENDPOINT ? originFromUrl(env.WEB_VITALS_ENDPOINT) : null;
  const crmExtraOrigins = env.CSP_CRM_EXTRA_ORIGINS
    ? env.CSP_CRM_EXTRA_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // D118/D906 (W2-SEC) — script-src entries mirror what shell() actually
  // emits (render-page.tsx):
  //   - unpkg.com: only the web-vitals loader uses it, and that snippet is
  //     only emitted when WEB_VITALS_ENDPOINT is set — so the entry is gated
  //     on the same env var. (Self-hosting a pinned copy is the D1011
  //     follow-up; until then the allowlist at least matches reality.)
  //   - cdn.calltracking.com: REMOVED. No site injects CTM today and the CTM
  //     decision is W3 scope — W3 must re-add the origin alongside whatever
  //     loader it actually ships (note: render-page.tsx's ctmScriptTag still
  //     exists and fires if a site sets ctm_account_id; until W3, such a
  //     script is deliberately CSP-blocked rather than silently allowed).
  //   - 'unsafe-inline' remains the documented tenant gap (header note
  //     above): the analytics/vitals/carousel-island inline scripts still
  //     depend on it; the studio host no longer does (buildStudioCsp).
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(env.WEB_VITALS_ENDPOINT ? ["unpkg.com"] : []),
    ...(analyticsOrigin ? [analyticsOrigin] : []),
  ];

  const connectSrc = [
    "'self'",
    ...(vitalsOrigin ? [vitalsOrigin] : []),
    ...(sentryOrigin ? [sentryOrigin] : []),
    ...(analyticsOrigin ? [analyticsOrigin] : []),
    ...crmExtraOrigins,
  ];

  // `'self'` is NOT optional (Studio preview regression, 2026-07-30 — operator
  // reported the workspace preview column permanently blank in prod, console:
  // "Framing '…/preview?v=0' violates frame-src 'none'"). `SitePreviewPanel`
  // embeds the app's OWN same-origin draft-preview route
  // (`/api/sites/:siteId/pages/:pageId/preview`) in an <iframe>; with the old
  // `crmExtraOrigins.length > 0 ? crmExtraOrigins : ["'none'"]`, any deployment
  // without CSP_CRM_EXTRA_ORIGINS set got `frame-src 'none'` and the browser
  // refused the frame before a single byte was requested. `'self'` permits
  // exactly that — this app framing its own routes — and grants nothing to any
  // third-party origin (CRM embeds still have to be listed explicitly).
  const frameSrc = ["'self'", ...crmExtraOrigins];

  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    // fonts.googleapis.com serves the CSS @font-face stylesheet loaded in index.html.
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    // fonts.gstatic.com serves the actual font binaries referenced by the Google Fonts CSS.
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    // blob: allows file-upload previews (URL.createObjectURL); images.unsplash.com
    // is used for hero/blog images in the marketing-site pages.
    imgSrc: ["'self'", "data:", "blob:", "storage.googleapis.com", "https://images.unsplash.com"],
    connectSrc,
    frameSrc,
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
  };
}
