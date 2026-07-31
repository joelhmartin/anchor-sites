/**
 * P12 — Unit tests for:
 * - analyticsScriptTag (12.2)
 * - buildCsp (12.5)
 * - sentry mode switch (12.4)
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("analyticsScriptTag (12.2)", () => {
  let analyticsScriptTag: typeof import("../../src/server/analytics.js").analyticsScriptTag;

  beforeEach(async () => {
    ({ analyticsScriptTag } = await import("../../src/server/analytics.js"));
  });

  it("emits Plausible script with correct data-domain", () => {
    const tag = analyticsScriptTag("acme.com", "https://analytics.example.com", "plausible");
    expect(tag).toContain('data-domain="acme.com"');
    expect(tag).toContain('src="https://analytics.example.com/js/script.js"');
    expect(tag).toContain("defer");
  });

  it("emits Umami script with data-website-id=domain", () => {
    const tag = analyticsScriptTag("acme.com", "https://umami.example.com", "umami");
    expect(tag).toContain('data-website-id="acme.com"');
    expect(tag).toContain('src="https://umami.example.com/script.js"');
  });

  it("HTML-escapes domain and baseUrl to prevent attribute injection", () => {
    const tag = analyticsScriptTag('<script>', '"bad"', "plausible");
    expect(tag).not.toContain("<script>");
    expect(tag).not.toContain('"bad"');
    expect(tag).toContain("&lt;script&gt;");
    expect(tag).toContain("&quot;bad&quot;");
  });

  it("defaults to plausible when provider is undefined", () => {
    const tag = analyticsScriptTag("acme.com", "https://a.example.com");
    expect(tag).toContain('data-domain="acme.com"');
    expect(tag).not.toContain("data-website-id");
  });
});

describe("buildCsp (12.5)", () => {
  let buildCsp: typeof import("../../src/server/csp.js").buildCsp;

  beforeEach(async () => {
    ({ buildCsp } = await import("../../src/server/csp.js"));
  });

  it("returns directives object with required keys", () => {
    const directives = buildCsp({});
    expect(directives).toHaveProperty("defaultSrc");
    expect(directives).toHaveProperty("scriptSrc");
    expect(directives).toHaveProperty("styleSrc");
    expect(directives).toHaveProperty("fontSrc");
    expect(directives).toHaveProperty("imgSrc");
    expect(directives).toHaveProperty("connectSrc");
    expect(directives).toHaveProperty("frameSrc");
    expect(directives).toHaveProperty("objectSrc");
  });

  it("includes Google Fonts origins for the SPA index.html stylesheet", () => {
    const directives = buildCsp({});
    const styleSrc = (directives.styleSrc as string[]).join(" ");
    const fontSrc = (directives.fontSrc as string[]).join(" ");
    expect(styleSrc).toContain("https://fonts.googleapis.com");
    expect(fontSrc).toContain("https://fonts.gstatic.com");
  });

  it("includes blob: and images.unsplash.com in imgSrc for SPA pages", () => {
    const directives = buildCsp({});
    const imgSrc = (directives.imgSrc as string[]).join(" ");
    expect(imgSrc).toContain("blob:");
    expect(imgSrc).toContain("https://images.unsplash.com");
  });

  it("injects ANALYTICS_BASE_URL into scriptSrc and connectSrc", () => {
    const directives = buildCsp({ ANALYTICS_BASE_URL: "https://analytics.example.com" });
    const scriptSrc = (directives.scriptSrc as string[]).join(" ");
    expect(scriptSrc).toContain("https://analytics.example.com");
  });

  it("injects WEB_VITALS_ENDPOINT into connectSrc", () => {
    const directives = buildCsp({ WEB_VITALS_ENDPOINT: "https://vitals.example.com/collect" });
    const connectSrc = (directives.connectSrc as string[]).join(" ");
    expect(connectSrc).toContain("https://vitals.example.com");
  });

  // D118/D906 (W2-SEC) — CSP entries mirror actually-injected scripts.
  describe("script-src mirrors what shell() actually emits", () => {
    it("unpkg.com appears ONLY when WEB_VITALS_ENDPOINT enables the vitals snippet", () => {
      expect((buildCsp({}).scriptSrc as string[]).join(" ")).not.toContain("unpkg.com");
      expect(
        (buildCsp({ WEB_VITALS_ENDPOINT: "https://vitals.example.com/c" }).scriptSrc as string[]).join(" "),
      ).toContain("unpkg.com");
    });

    it("cdn.calltracking.com is gone until the W3 CTM decision ships a real loader", () => {
      const all = Object.values(buildCsp({})).flat().join(" ");
      expect(all).not.toContain("calltracking.com");
    });
  });

  it("injects SENTRY_DSN origin into connectSrc", () => {
    const directives = buildCsp({ SENTRY_DSN: "https://abc123@o0.ingest.sentry.io/12345" });
    const connectSrc = (directives.connectSrc as string[]).join(" ");
    expect(connectSrc).toContain("https://o0.ingest.sentry.io");
  });

  it("appends CSP_CRM_EXTRA_ORIGINS to connectSrc and frameSrc", () => {
    const directives = buildCsp({ CSP_CRM_EXTRA_ORIGINS: "https://crm.example.com,https://forms.example.com" });
    const connectSrc = (directives.connectSrc as string[]).join(" ");
    const frameSrc = (directives.frameSrc as string[]).join(" ");
    expect(connectSrc).toContain("https://crm.example.com");
    expect(frameSrc).toContain("https://crm.example.com");
    expect(connectSrc).toContain("https://forms.example.com");
  });

  // Studio preview regression (2026-07-30, operator-reported in prod). The
  // Studio SPA frames its OWN same-origin draft preview
  // (`/api/sites/:id/pages/:id/preview`) in `SitePreviewPanel`'s <iframe>.
  // `frame-src 'none'` blocked that outright — the console showed
  // "Framing '…/preview?v=0' violates frame-src 'none'" and the workspace
  // preview column was permanently blank in production. `'self'` is the
  // minimum that lets the app frame its own routes; it grants nothing to any
  // third-party origin.
  it("always includes 'self' in frameSrc so Studio can frame its own preview route", () => {
    const frameSrc = buildCsp({}).frameSrc as string[];
    expect(frameSrc).toContain("'self'");
    expect(frameSrc).not.toContain("'none'");
  });

  it("keeps 'self' in frameSrc alongside CRM extra origins", () => {
    const frameSrc = buildCsp({
      CSP_CRM_EXTRA_ORIGINS: "https://crm.example.com",
    }).frameSrc as string[];
    expect(frameSrc).toContain("'self'");
    expect(frameSrc).toContain("https://crm.example.com");
  });
});

describe("captureException mode switch (12.4)", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("resolveServerSentry returns stub when no DSN and not disabled", async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_DISABLED;
    const { resolveServerSentry } = await import("../../src/server/sentry/index.js");
    const sentry = resolveServerSentry(process.env);
    expect(typeof sentry.captureException).toBe("function");
    // stub should not throw
    expect(() => sentry.captureException(new Error("test"))).not.toThrow();
    expect(sentry.mode).toBe("stub");
  });

  it("resolveServerSentry returns disabled when SENTRY_DISABLED=true", async () => {
    process.env.SENTRY_DISABLED = "true";
    delete process.env.SENTRY_DSN;
    const { resolveServerSentry } = await import("../../src/server/sentry/index.js");
    const sentry = resolveServerSentry(process.env);
    expect(sentry.mode).toBe("disabled");
    expect(() => sentry.captureException(new Error("test"))).not.toThrow();
  });
});
