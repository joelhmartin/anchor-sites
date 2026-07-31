import { describe, expect, it } from "vitest";
import { buildPreviewHrefResolver, rewriteSiteRelativeHrefs } from "./preview-links.js";

/**
 * FINAL whole-branch review, FIX-NOW item 6 — preview iframe nav escape.
 * See `preview-links.ts`'s header for the bug and the design decisions these
 * pin (query propagation, edit/bridge exclusion, inert unknown slugs).
 */

const SITE = "site-1";
const PAGES = [
  { id: "pg-home", slug: "home" },
  { id: "pg-about", slug: "about" },
];

function resolver(query?: Record<string, unknown>) {
  return buildPreviewHrefResolver({ siteId: SITE, pages: PAGES, query });
}

describe("buildPreviewHrefResolver", () => {
  it("maps /<slug> to that page's own preview URL", () => {
    expect(resolver()("/about")).toBe(`/api/sites/${SITE}/pages/pg-about/preview`);
  });

  it("maps / (and a bare trailing slash) to the home page", () => {
    expect(resolver()("/")).toBe(`/api/sites/${SITE}/pages/pg-home/preview`);
    expect(resolver()("/about/")).toBe(`/api/sites/${SITE}/pages/pg-about/preview`);
  });

  it("returns null for a slug with no matching page (caller makes it inert)", () => {
    expect(resolver()("/services")).toBeNull();
  });

  it("propagates the current preview's query params (token, cache-buster)", () => {
    const resolve = resolver({ token: "tok-123", v: "7" });
    expect(resolve("/about")).toBe(`/api/sites/${SITE}/pages/pg-about/preview?token=tok-123&v=7`);
  });

  it("never propagates edit/bridge — a bridge token is bound to ONE pageId", () => {
    const resolve = resolver({ token: "tok-123", edit: "1", bridge: "tok_abc" });
    const out = resolve("/about")!;
    expect(out).toContain("token=tok-123");
    expect(out).not.toContain("edit=");
    expect(out).not.toContain("bridge=");
  });

  it("keeps a fragment and drops a site-relative query string", () => {
    expect(resolver()("/about#team")).toBe(`/api/sites/${SITE}/pages/pg-about/preview#team`);
    expect(resolver()("/about?utm=x")).toBe(`/api/sites/${SITE}/pages/pg-about/preview`);
  });
});

describe("rewriteSiteRelativeHrefs", () => {
  const resolve = resolver({ token: "tok-123" });

  it("rewrites a site-relative href to the sibling page's preview URL, escaping the separator", () => {
    const html = '<a href="/about">About</a>';
    expect(rewriteSiteRelativeHrefs(html, resolver({ token: "t", v: "2" }))).toBe(
      `<a href="/api/sites/${SITE}/pages/pg-about/preview?token=t&amp;v=2">About</a>`,
    );
  });

  it("makes an unknown slug inert instead of letting it escape to the admin origin", () => {
    expect(rewriteSiteRelativeHrefs('<a href="/nope">x</a>', resolve)).toBe('<a href="#">x</a>');
  });

  it("leaves absolute, protocol-relative, scheme and in-page hrefs alone", () => {
    const html = [
      '<a href="https://example.com/about">abs</a>',
      '<a href="//evil.example/about">proto-rel</a>',
      '<a href="mailto:hi@example.com">mail</a>',
      '<a href="tel:+15550001111">tel</a>',
      '<a href="#team">anchor</a>',
    ].join("");
    expect(rewriteSiteRelativeHrefs(html, resolve)).toBe(html);
  });

  it("handles single-quoted attributes and multiple links in one pass", () => {
    const html = `<a href='/'>Home</a><a href="/about">About</a>`;
    const out = rewriteSiteRelativeHrefs(html, resolve);
    expect(out).toContain(`href='/api/sites/${SITE}/pages/pg-home/preview?token=tok-123'`);
    expect(out).toContain(`href="/api/sites/${SITE}/pages/pg-about/preview?token=tok-123"`);
  });
});
