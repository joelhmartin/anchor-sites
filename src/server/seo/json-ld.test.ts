import { describe, expect, it } from "vitest";
import {
  blogPostingLd,
  eventLd,
  organizationLd,
  renderJsonLd,
  webPageLd,
  webSiteLd,
} from "./json-ld.js";
import type { ResolvedSite } from "../../middleware/resolveSite.js";

const site = { slug: "acme", display_name: "Acme Dental" } as unknown as ResolvedSite;
const URL = "https://acme.sites.anchorcorps.com";

describe("JSON-LD builders (P9-T9.4, D-049)", () => {
  it("organizationLd / webSiteLd carry name + url + @context", () => {
    expect(organizationLd(site, URL)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme Dental",
      url: URL,
    });
    expect(webSiteLd(site, URL)["@type"]).toBe("WebSite");
  });

  it("webPageLd includes description/image only when set", () => {
    expect(webPageLd({ name: "Home", url: URL })).not.toHaveProperty("description");
    const full = webPageLd({ name: "Home", url: URL, description: "D", image: `${URL}/x.jpg` });
    expect(full).toMatchObject({ description: "D", image: `${URL}/x.jpg` });
  });

  it("blogPostingLd sets headline, datePublished, author, publisher", () => {
    const ld = blogPostingLd({
      site,
      headline: "My Post",
      description: "About",
      url: `${URL}/blog/my-post`,
      image: `${URL}/i.jpg`,
      datePublished: "2026-06-01T00:00:00.000Z",
      authorName: "Jane",
    });
    expect(ld).toMatchObject({
      "@type": "BlogPosting",
      headline: "My Post",
      datePublished: "2026-06-01T00:00:00.000Z",
      author: { "@type": "Person", name: "Jane" },
      publisher: { "@type": "Organization", name: "Acme Dental" },
    });
  });

  it("blogPostingLd omits author/date when absent", () => {
    const ld = blogPostingLd({ site, headline: "X", url: URL });
    expect(ld).not.toHaveProperty("author");
    expect(ld).not.toHaveProperty("datePublished");
  });

  it("eventLd sets startDate/endDate and a Place location", () => {
    const ld = eventLd({
      name: "Gala",
      url: `${URL}/events/gala`,
      startDate: "2026-09-01T18:00:00.000Z",
      endDate: "2026-09-01T22:00:00.000Z",
      location: "Grand Hall",
    });
    expect(ld).toMatchObject({
      "@type": "Event",
      startDate: "2026-09-01T18:00:00.000Z",
      endDate: "2026-09-01T22:00:00.000Z",
      location: { "@type": "Place", name: "Grand Hall" },
    });
  });
});

describe("renderJsonLd", () => {
  it("emits one script per non-null node and drops nulls", () => {
    const html = renderJsonLd([organizationLd(site, URL), null, undefined, webSiteLd(site, URL)]);
    expect((html.match(/<script type="application\/ld\+json">/g) ?? []).length).toBe(2);
  });

  it("escapes < to prevent breaking out of the script element", () => {
    const html = renderJsonLd([webPageLd({ name: "</script><x>", url: URL })]);
    expect(html).not.toContain("</script><x>");
    expect(html).toContain("\\u003c/script>");
  });

  it("returns empty string for no nodes", () => {
    expect(renderJsonLd([null, undefined])).toBe("");
  });
});
