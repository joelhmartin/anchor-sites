/**
 * W2-SEC — per-host security headers through the REAL app (createApp).
 *
 * D810: the studio host serves its own CSP (never unpkg/calltracking —
 * those are tenant-page entries); tenant/unknown hosts keep the tenant
 * policy. Production-only strictness (script-src 'self' with no
 * 'unsafe-inline') is asserted in tests/unit/studio-csp.test.ts against
 * buildStudioCsp directly — stubbing NODE_ENV=production here would poison
 * the fork's dev JSX runtime for every later SSR test (jsxDEV mismatch).
 *
 * The preview routes' per-response CSP (admin-pages.ts / templates.ts,
 * incl. the D1200 carousel-island hash) is set via res.setHeader AFTER
 * helmet ran, so it replaces whichever host policy applied — covered by
 * tests/integration/inline-preview.test.ts and template-preview.test.ts.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";

describe("per-host CSP (D810)", () => {
  const app = createApp({ activePlugins: [] });

  it("studio host: no unpkg.com / cdn.calltracking.com anywhere in the policy", async () => {
    const res = await request(app).get("/healthz").set("Host", "studio.localhost");
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).not.toContain("unpkg.com");
    expect(csp).not.toContain("calltracking.com");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("'self'");
  });

  it("configured STUDIO_HOST default is also recognized", async () => {
    const res = await request(app).get("/healthz").set("Host", "studio.anchorcorps.com");
    const csp = res.headers["content-security-policy"];
    expect(csp).not.toContain("unpkg.com");
    expect(csp).not.toContain("calltracking.com");
  });

  it("tenant/unknown hosts keep the tenant policy", async () => {
    const res = await request(app).get("/healthz").set("Host", "acme.sites.anchorcorps.com");
    const csp = res.headers["content-security-policy"];
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    // The tenant surface still carries its documented 'unsafe-inline' gap
    // (csp.ts header note) — the studio host must not inherit it.
    expect(scriptSrc).toContain("'unsafe-inline'");
  });
});
