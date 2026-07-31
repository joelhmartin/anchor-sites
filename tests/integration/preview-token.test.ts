import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";
import { PREVIEW_TOKEN_TTL_MS, mintPreviewToken } from "../../src/server/preview-token.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

/**
 * Studio preview auth — mint endpoint + the preview route's dual-credential
 * query gate (2026-07-30 lovable-workspace SDD; operator-reported prod break).
 *
 * The sandboxed preview <iframe> sends no cookies and can set no headers, so
 * the query string is its only credential channel. `POST
 * /api/sites/:siteId/preview-token` mints a 15-minute, site-scoped HMAC the
 * Studio SPA can safely put there; the preview route accepts it OR (still)
 * the static ADMIN_API_TOKEN. See src/server/preview-token.ts.
 */
d("preview tokens (admin-pages.ts + preview-token.ts)", () => {
  const db = setupAgentDb();
  let app: express.Express;

  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
    vi.stubEnv("BETTER_AUTH_SECRET", "integration-preview-secret-0123456789");
  });

  beforeAll(async () => {
    await db.runMigrations();
    const a = express();
    a.use(express.json());
    a.use("/api", adminPagesRouter({ pool: db.getPool() }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  // ── mint endpoint ──

  it("POST /api/sites/:siteId/preview-token returns { token, expires_at } ~15 min out", async () => {
    const site = await db.seedSite("preview-token-mint");
    const before = Date.now();

    const res = await auth(request(app).post(`/api/sites/${site.id}/preview-token`));

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.startsWith("pv1.")).toBe(true);
    const expiresAt = Date.parse(res.body.expires_at);
    expect(Number.isNaN(expiresAt)).toBe(false);
    expect(expiresAt).toBeGreaterThan(before);
    // Second-resolution exp; allow the truncation on the low side.
    expect(expiresAt).toBeGreaterThan(before + PREVIEW_TOKEN_TTL_MS - 2000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PREVIEW_TOKEN_TTL_MS);
  });

  it("requires admin auth — an unauthenticated mint is a 401, not a free token", async () => {
    const site = await db.seedSite("preview-token-authz");
    const res = await request(app).post(`/api/sites/${site.id}/preview-token`);
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("404s for a site that does not exist (no minting tokens for phantom scopes)", async () => {
    const res = await auth(
      request(app).post(`/api/sites/00000000-0000-4000-8000-000000000000/preview-token`),
    );
    expect(res.status).toBe(404);
  });

  // ── the preview route's query gate ──

  it("a minted token authenticates the preview iframe with no header and no cookie", async () => {
    const site = await db.seedSite("preview-token-use");
    const page = await db.seedPage(site.id, "home", [
      { id: "r1", type: "rich-text", props: { html: "<p>Draft body</p>" } },
    ]);

    const mint = await auth(request(app).post(`/api/sites/${site.id}/preview-token`));
    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${page.id}/preview?token=${encodeURIComponent(mint.body.token)}&v=3`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain("Draft body");
  });

  // The scope check is the reason the siteId is inside the MAC. Site A's
  // operator must not be able to read site B's unpublished drafts by
  // retargeting the URL.
  it("401s when a valid token for site A is presented to site B's preview", async () => {
    const siteA = await db.seedSite("preview-token-scope-a");
    const siteB = await db.seedSite("preview-token-scope-b");
    const pageB = await db.seedPage(siteB.id, "home", []);

    const mint = await auth(request(app).post(`/api/sites/${siteA.id}/preview-token`));
    const res = await request(app).get(
      `/api/sites/${siteB.id}/pages/${pageB.id}/preview?token=${encodeURIComponent(mint.body.token)}`,
    );

    expect(res.status).toBe(401);
  });

  it("401s on an expired token", async () => {
    const site = await db.seedSite("preview-token-expired");
    const page = await db.seedPage(site.id, "home", []);
    const expired = mintPreviewToken(site.id, {
      env: process.env,
      now: Date.now() - 60 * 60 * 1000,
    })!;

    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${page.id}/preview?token=${encodeURIComponent(expired.token)}`,
    );

    expect(res.status).toBe(401);
  });

  it("401s on a garbage token", async () => {
    const site = await db.seedSite("preview-token-garbage");
    const page = await db.seedPage(site.id, "home", []);
    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${page.id}/preview?token=pv1.${site.id}.9999999999.AAAA`,
    );
    expect(res.status).toBe(401);
  });

  // Backward compat: curl/dev and the legacy paste-token Studio login both
  // put the STATIC admin token in `?token=`. That path must keep working.
  it("still accepts the static ADMIN_API_TOKEN in ?token= (backward compat)", async () => {
    const site = await db.seedSite("preview-token-static");
    const page = await db.seedPage(site.id, "home", [
      { id: "r1", type: "rich-text", props: { html: "<p>Static token body</p>" } },
    ]);

    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${page.id}/preview?token=${ADMIN_TOKEN}`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain("Static token body");
  });

  // Edit mode rides the same query string; the preview token has to survive
  // alongside `edit=1&bridge=` or toggling Edit would 401 the frame.
  it("authenticates edit mode (?edit=1&bridge=) with a preview token", async () => {
    const site = await db.seedSite("preview-token-edit");
    const page = await db.seedPage(site.id, "home", [
      { id: "r1", type: "rich-text", props: { html: "<p>Editable body</p>" } },
    ]);

    const mint = await auth(request(app).post(`/api/sites/${site.id}/preview-token`));
    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${page.id}/preview` +
        `?token=${encodeURIComponent(mint.body.token)}&v=0&edit=1&bridge=tok_abc123`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain("window.__AC_EDIT_BOOT__");
  });

  // preview-links.ts propagates every non-edit/bridge query param onto
  // rewritten hrefs, so cross-page navigation INSIDE the preview stays
  // authenticated. That is only correct because the token is site-scoped:
  // every sibling page it can reach belongs to the same site.
  it("propagates the preview token onto rewritten sibling-page links", async () => {
    const site = await db.seedSite("preview-token-links");
    const home = await db.seedPage(site.id, "home", [
      { id: "r1", type: "rich-text", props: { html: '<p><a href="/about">About</a></p>' } },
    ]);
    const about = await db.seedPage(site.id, "about", []);

    const mint = await auth(request(app).post(`/api/sites/${site.id}/preview-token`));
    const token: string = mint.body.token;
    const res = await request(app).get(
      `/api/sites/${site.id}/pages/${home.id}/preview?token=${encodeURIComponent(token)}&v=1`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain(
      `href="/api/sites/${site.id}/pages/${about.id}/preview?token=${token}&amp;v=1"`,
    );

    // …and that rewritten URL really does authenticate.
    const followed = await request(app).get(
      `/api/sites/${site.id}/pages/${about.id}/preview?token=${encodeURIComponent(token)}&v=1`,
    );
    expect(followed.status).toBe(200);
  });
});
