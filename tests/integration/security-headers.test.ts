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

  // D809/D909 — the blanket app.use(cors()) stamped
  // `Access-Control-Allow-Origin: *` on EVERY response (admin APIs
  // included). No cross-origin consumer exists for admin or tenant
  // surfaces (the SPA is same-origin with the API; tenant pages fetch
  // same-origin; a `*` grant can't serve credentialed requests anyway).
  // Only /api/vitals keeps a scoped grant: its snippet POSTs to a
  // configurable WEB_VITALS_ENDPOINT that may be a central collector on
  // another origin.
  describe("CORS is scoped to the vitals ingester only (D809/D909)", () => {
    it("admin API responses carry no Access-Control-Allow-Origin", async () => {
      const res = await request(app).get("/api/does-not-exist").set("Host", "studio.localhost");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("tenant responses carry no Access-Control-Allow-Origin", async () => {
      const res = await request(app).get("/healthz").set("Host", "acme.sites.anchorcorps.com");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("POST /api/vitals still answers cross-origin (grant + preflight)", async () => {
      const post = await request(app)
        .post("/api/vitals")
        .set("Origin", "https://acme.sites.anchorcorps.com")
        .send({ name: "LCP", value: 1200, id: "v1-abc", delta: 1200 });
      expect(post.status).toBe(204);
      expect(post.headers["access-control-allow-origin"]).toBe("*");

      const preflight = await request(app)
        .options("/api/vitals")
        .set("Origin", "https://acme.sites.anchorcorps.com")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type");
      expect(preflight.status).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    });
  });

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
