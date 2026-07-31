import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

/**
 * Inline Editing Task 4 — edit-mode preview render + route branch.
 *
 * Covers the `?edit=1&bridge=<token>` branch of the draft-preview route
 * (admin-pages.ts): block markers (`data-block-id` / `data-field`), the
 * nonce-scoped boot script (`window.__AC_EDIT_BOOT__` + the compiled overlay
 * bundle), the swapped CSP (`script-src 'nonce-...'` instead of `'none'`),
 * and the 400 on a malformed Studio-minted bridge token. Also re-asserts the
 * plain (non-edit) preview path is byte-behavior unchanged — no markers, no
 * boot script, `script-src 'none'` — since this route's existing CSP/body
 * literal must stay intact for every caller that doesn't pass `?edit=1`.
 */
d("inline preview (admin-pages.ts, Inline Editing Task 4)", () => {
  const db = setupAgentDb();
  let app: express.Express;

  const heroAndRichText = [
    {
      id: "h1",
      type: "hero",
      props: { title: "Welcome to Acme", align: "center", cta_href: "https://example.com/contact" },
    },
    { id: "r1", type: "rich-text", props: { html: "<p>Body copy</p>" } },
  ];

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // then guarantees this resets before the next test anywhere in the suite,
  // regardless of how long this file's own `afterAll` takes (root cause of
  // the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
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

  it("?edit=1&bridge=<token> renders block markers + boot script and swaps CSP to a nonce", async () => {
    const site = await db.seedSite("inline-preview-edit");
    const page = await db.seedPage(site.id, "home", heroAndRichText);

    const res = await auth(
      request(app).get(`/api/sites/${site.id}/pages/${page.id}/preview?edit=1&bridge=tok_abc123`),
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain("data-block-id");
    expect(res.text).toContain('data-field="title"');
    expect(res.text).toContain("window.__AC_EDIT_BOOT__");
    expect(res.text).toContain('"token":"tok_abc123"');
    expect(res.text).toContain("__AC_EDIT_OVERLAY__");
    // Task 7 — bootData.urls carries the CURRENT value of every url-classified
    // field (built server-side from page.blocks + the classifier), keyed by
    // blockId then field name, so the overlay's link chip can hand Studio's
    // popover a starting value.
    expect(res.text).toContain('"urls":{"h1":{"cta_href":"https://example.com/contact"}}');

    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).not.toContain("'none'");
  });

  it("plain preview (no ?edit=1) stays byte-behavior unchanged: script-src 'none', no markers, no boot script", async () => {
    const site = await db.seedSite("inline-preview-plain");
    const page = await db.seedPage(site.id, "home", heroAndRichText);

    const res = await auth(request(app).get(`/api/sites/${site.id}/pages/${page.id}/preview`));

    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(res.text).not.toContain("data-block-id");
    expect(res.text).not.toContain("window.__AC_EDIT_BOOT__");
  });

  // ── FINAL whole-branch review, FIX-NOW item 6 — preview iframe nav escape ──
  //
  // `<a href="/about">` inside the sandboxed preview resolves against the
  // preview's own document URL, which is on the ADMIN origin — so a click
  // used to navigate the frame to the admin SPA. See src/server/preview-links.ts.

  const internalLinkBlocks = [
    // cta_label is explicit: since D713 an omitted label means "no CTA"
    // (schemas no longer default a phantom "Get started" button into being).
    { id: "h1", type: "hero", props: { title: "Welcome", align: "center", cta_label: "About", cta_href: "/about" } },
    {
      id: "r1",
      type: "rich-text",
      props: {
        html: '<p><a href="/">Home</a> <a href="/nowhere">Missing</a> <a href="https://example.com/x">Out</a> <a href="#top">Top</a></p>',
      },
    },
  ];

  it("rewrites site-relative hrefs to sibling pages' preview URLs (and leaves external/anchor links alone)", async () => {
    const site = await db.seedSite("preview-links");
    const home = await db.seedPage(site.id, "home", internalLinkBlocks);
    const about = await db.seedPage(site.id, "about", []);

    const res = await auth(
      request(app).get(`/api/sites/${site.id}/pages/${home.id}/preview?token=tok&v=3`),
    );

    expect(res.status).toBe(200);
    // /about → the About page's own preview, carrying the same token + v.
    expect(res.text).toContain(
      `href="/api/sites/${site.id}/pages/${about.id}/preview?token=tok&amp;v=3"`,
    );
    // / → the home page's own preview.
    expect(res.text).toContain(
      `href="/api/sites/${site.id}/pages/${home.id}/preview?token=tok&amp;v=3"`,
    );
    // Nothing site-relative survives to navigate the frame off-preview.
    expect(res.text).not.toContain('href="/about"');
    expect(res.text).not.toContain('href="/nowhere"');
    // Unknown slug → inert; external + in-page anchors untouched.
    expect(res.text).toContain('href="#"');
    expect(res.text).toContain('href="https://example.com/x"');
    expect(res.text).toContain('href="#top"');
  });

  it("edit-mode preview rewrites the same way, but never carries edit/bridge into a navigation", async () => {
    const site = await db.seedSite("preview-links-edit");
    const home = await db.seedPage(site.id, "home", internalLinkBlocks);
    const about = await db.seedPage(site.id, "about", []);

    const res = await auth(
      request(app).get(
        `/api/sites/${site.id}/pages/${home.id}/preview?token=tok&edit=1&bridge=tok_abc123`,
      ),
    );

    expect(res.status).toBe(200);
    // Still edit mode for THIS page (overlay boots, bootData carries the
    // bridge token + the url-field values the LinkPopover reads).
    expect(res.text).toContain("window.__AC_EDIT_BOOT__");
    expect(res.text).toContain('"token":"tok_abc123"');
    expect(res.text).toContain('"urls":{"h1":{"cta_href":"/about"}}');
    // …but a navigation out of it lands in PLAIN preview: a bridge token is
    // bound to one pageId, so carrying it to another page would hand the
    // overlay a session that saves to the wrong page.
    expect(res.text).toContain(`href="/api/sites/${site.id}/pages/${about.id}/preview?token=tok"`);
    expect(res.text).not.toContain("bridge=tok_abc123&");
    expect(res.text).not.toContain("preview?token=tok&amp;edit=1");
  });

  // Previews must never inject third-party tracking: the sandboxed iframe
  // (no allow-same-origin) makes cookie-writing scripts throw on load, and a
  // draft view is not real traffic (operator console report, 2026-07-30).
  it("preview HTML omits CTM/analytics scripts even when the site has them enabled", async () => {
    const site = await db.seedSite("inline-preview-notrack");
    const page = await db.seedPage(site.id, "home", heroAndRichText);
    await db
      .getPool()
      .query(
        `UPDATE sites SET ctm_account_id = 'ctm-test-123', analytics_disabled = false WHERE id = $1`,
        [site.id],
      );

    const res = await auth(request(app).get(`/api/sites/${site.id}/pages/${page.id}/preview`));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("calltracking");
    expect(res.text).not.toContain("ctm-test-123");
  });

  it("?edit=1 with a malformed bridge token 400s", async () => {
    const site = await db.seedSite("inline-preview-bad-bridge");
    const page = await db.seedPage(site.id, "home", heroAndRichText);

    const res = await auth(
      request(app).get(
        `/api/sites/${site.id}/pages/${page.id}/preview?edit=1&bridge=${encodeURIComponent("<script>")}`,
      ),
    );

    expect(res.status).toBe(400);
  });
});

