/**
 * W2-SEC D810 — Studio-host Content Security Policy.
 *
 * The admin SPA is a plain Vite build: dist/index.html carries ZERO inline
 * scripts (one external module script + one stylesheet), so the studio origin
 * never needs 'unsafe-inline' in script-src, and it loads nothing from
 * unpkg.com or cdn.calltracking.com — those belong to the tenant surface
 * only. The one exception is dev, where the @vitejs/plugin-react preamble is
 * a real inline script; the relaxation is keyed on NODE_ENV !== "production",
 * exactly mirroring when src/server/index.ts mounts Vite middleware.
 */
import { describe, expect, it } from "vitest";
import { buildStudioCsp } from "../../src/server/csp.js";

describe("buildStudioCsp (D810)", () => {
  it("production script-src is 'self' only — no unsafe-inline, no third-party CDNs", () => {
    const d = buildStudioCsp({ NODE_ENV: "production" });
    expect(d.scriptSrc).toEqual(["'self'"]);
  });

  it("never allowlists unpkg.com or cdn.calltracking.com in any directive", () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, {}]) {
      const d = buildStudioCsp(env as NodeJS.ProcessEnv);
      const all = Object.values(d).flat().join(" ");
      expect(all).not.toContain("unpkg.com");
      expect(all).not.toContain("calltracking.com");
    }
  });

  it("dev keeps 'unsafe-inline' for the Vite react-refresh preamble (and ws for HMR)", () => {
    const d = buildStudioCsp({ NODE_ENV: "development" });
    expect(d.scriptSrc).toContain("'unsafe-inline'");
    expect(d.connectSrc).toContain("ws:");
  });

  it("keeps the SPA's real needs: fonts, self frames (preview iframes), media/stock images", () => {
    const d = buildStudioCsp({ NODE_ENV: "production" });
    expect(d.styleSrc).toContain("https://fonts.googleapis.com");
    expect(d.fontSrc).toContain("https://fonts.gstatic.com");
    // SitePreviewPanel embeds the app's OWN same-origin preview routes.
    expect(d.frameSrc).toEqual(["'self'"]);
    // Media library thumbnails (GCS) + Pixabay stock-search previews.
    expect(d.imgSrc).toContain("storage.googleapis.com");
    expect(d.imgSrc).toContain("https://cdn.pixabay.com");
    expect(d.objectSrc).toEqual(["'none'"]);
    expect(d.baseUri).toEqual(["'self'"]);
  });

  it("connect-src carries the Sentry origin when configured", () => {
    const d = buildStudioCsp({
      NODE_ENV: "production",
      SENTRY_DSN: "https://abc123@o0.ingest.sentry.io/1",
    } as NodeJS.ProcessEnv);
    expect(d.connectSrc).toContain("https://o0.ingest.sentry.io");
  });
});
