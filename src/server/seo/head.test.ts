import { describe, expect, it } from "vitest";
import { renderSeoMeta } from "../render-page.js";
import type { ResolvedSite } from "../../middleware/resolveSite.js";
import type { SeoFields } from "./schema.js";

const makeSite = (seo_defaults: Record<string, unknown> = {}) =>
  ({
    id: "s1",
    slug: "acme",
    display_name: "Acme Dental",
    default_brand_tokens: {},
    seo_defaults,
    matched_via: "subdomain",
    plugins: [],
  }) as unknown as ResolvedSite;

const site = makeSite();
const meta = (seo: SeoFields, path?: string) => renderSeoMeta(site, seo, { path });

describe("renderSeoMeta (P9-T9.2, D-049)", () => {
  it("defaults robots to index,follow", () => {
    expect(meta({})).toContain('<meta name="robots" content="index,follow" />');
  });

  it("emits noindex,nofollow when both are off", () => {
    expect(meta({ robots: { index: false, follow: false } })).toContain(
      '<meta name="robots" content="noindex,nofollow" />',
    );
  });

  it("builds a canonical from the tenant host + path when not overridden", () => {
    const html = meta({}, "/about");
    expect(html).toContain('<link rel="canonical" href="https://acme.sites.anchorcorps.com/about" />');
    expect(html).toContain('<meta property="og:url" content="https://acme.sites.anchorcorps.com/about" />');
  });

  it("canonicalizes the home path to /", () => {
    expect(meta({}, "/")).toContain('href="https://acme.sites.anchorcorps.com/"');
  });

  it("strips query strings and trailing slashes from the canonical path", () => {
    expect(meta({}, "/blog/post-1/?utm=x")).toContain(
      'href="https://acme.sites.anchorcorps.com/blog/post-1"',
    );
  });

  it("honors an explicit canonical override", () => {
    expect(meta({ canonical: "https://custom.example.com/x" }, "/ignored")).toContain(
      '<link rel="canonical" href="https://custom.example.com/x" />',
    );
  });

  it("falls back og:title to seo.title then site name, og:description to seo.description", () => {
    expect(meta({ title: "Page T", description: "Page D" })).toContain(
      '<meta property="og:title" content="Page T" />',
    );
    expect(meta({ title: "Page T", description: "Page D" })).toContain(
      '<meta property="og:description" content="Page D" />',
    );
    expect(meta({})).toContain('<meta property="og:title" content="Acme Dental" />');
  });

  it("prefers explicit og fields over the page title/description", () => {
    const html = meta({ title: "T", og: { title: "OG T", description: "OG D" } });
    expect(html).toContain('<meta property="og:title" content="OG T" />');
    expect(html).toContain('<meta property="og:description" content="OG D" />');
  });

  it("defaults twitter:card to summary_large_image, honors an override", () => {
    expect(meta({})).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(meta({ twitter: { card: "summary" } })).toContain(
      '<meta name="twitter:card" content="summary" />',
    );
  });

  it("escapes HTML in SEO content", () => {
    expect(meta({ og: { title: '"><script>' } })).toContain(
      "&quot;&gt;&lt;script&gt;",
    );
  });

  it("always includes og:type and og:site_name", () => {
    const html = meta({});
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:site_name" content="Acme Dental" />');
  });

  it("emits twitter:site from the site-level handle (P9-T9.3)", () => {
    const html = renderSeoMeta(makeSite({ twitterHandle: "acme" }), {}, {});
    expect(html).toContain('<meta name="twitter:site" content="@acme" />');
  });

  it("omits twitter:site when no site handle is set", () => {
    expect(meta({})).not.toContain('name="twitter:site"');
  });
});
