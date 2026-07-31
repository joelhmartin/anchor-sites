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

function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function buildCsp(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const analyticsOrigin = env.ANALYTICS_BASE_URL ? originFromUrl(env.ANALYTICS_BASE_URL) : null;
  const sentryOrigin = env.SENTRY_DSN ? originFromUrl(env.SENTRY_DSN) : null;
  const vitalsOrigin = env.WEB_VITALS_ENDPOINT ? originFromUrl(env.WEB_VITALS_ENDPOINT) : null;
  const crmExtraOrigins = env.CSP_CRM_EXTRA_ORIGINS
    ? env.CSP_CRM_EXTRA_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "cdn.calltracking.com",
    "unpkg.com",
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
