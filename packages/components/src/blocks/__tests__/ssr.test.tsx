import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FaqAccordion } from "../faq-accordion/component.js";
import { faqAccordionSchema } from "../faq-accordion/schema.js";
import { HeroSlider } from "../hero-slider/component.js";
import { heroSliderSchema } from "../hero-slider/schema.js";
import { TestimonialCarousel } from "../testimonial-carousel/component.js";
import { testimonialCarouselSchema } from "../testimonial-carousel/schema.js";
import { CAROUSEL_ISLAND_JS } from "../../primitives/carousel-island.js";

/**
 * D1200 — SSR-string contract tests (the exact gap the audit named: no
 * SSR-string assertion existed anywhere, which is why zero-JS pages shipping
 * dead widgets was never caught).
 *
 * Published tenant pages are `renderToString` output with no hydration and —
 * in previews — a CSP of `script-src 'none'`/nonce-only. Everything a
 * visitor can interact with must therefore be NATIVE HTML behavior
 * (details/summary, scroll-snap), or progressive enhancement that degrades
 * to native behavior. These tests assert against the raw SSR string.
 */

describe("SSR: faq-accordion (D1200)", () => {
  const props = faqAccordionSchema.parse({
    heading: "FAQ",
    items: [
      { question: "What are your hours?", answer: "We are open 9-5 weekdays." },
      { question: "Do you take insurance?", answer: "Yes, most major plans." },
    ],
  });

  it("every answer is present in the HTML (SEO + no-JS visitors)", () => {
    const html = renderToString(<FaqAccordion {...props} />);
    expect(html).toContain("We are open 9-5 weekdays.");
    expect(html).toContain("Yes, most major plans.");
  });

  it("interaction is native <details>/<summary> — no framework runtime required", () => {
    const html = renderToString(<FaqAccordion {...props} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    // No Radix state machine leftovers and no client-side handlers needed.
    expect(html).not.toContain("data-state");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<script");
  });

  it("single-open mode groups items via <details name>; multiple mode does not", () => {
    const single = renderToString(<FaqAccordion {...props} multiple={false} />);
    expect(single).toMatch(/<details[^>]*\sname="/);
    const multi = renderToString(<FaqAccordion {...props} multiple={true} />);
    expect(multi).not.toMatch(/<details[^>]*\sname="/);
  });
});

describe("SSR: hero-slider (D1200)", () => {
  const props = heroSliderSchema.parse({
    slides: [
      { title: "First headline", subtitle: "Sub one" },
      { title: "Second headline" },
      { title: "Third headline" },
    ],
    autoplay: true,
    interval_ms: 6000,
  });

  it("every slide's content is present in the HTML", () => {
    const html = renderToString(<HeroSlider {...props} />);
    expect(html).toContain("First headline");
    expect(html).toContain("Second headline");
    expect(html).toContain("Third headline");
    expect(html).toContain("Sub one");
  });

  it("base interaction is native scroll-snap; arrows are not shipped disabled", () => {
    const html = renderToString(<HeroSlider {...props} />);
    expect(html).toContain("data-ac-viewport");
    expect(html).toMatch(/snap-x/);
    expect(html).toMatch(/overflow-x-auto/);
    // The Embla-era bug: SSR'd arrows were disabled forever. Never again.
    // (attribute-exact: Tailwind disabled: variants legitimately appear in class lists)
    expect(html).not.toContain('disabled=""');
  });

  it("carries loop + autoplay knobs and embeds the enhancement island inline", () => {
    const html = renderToString(<HeroSlider {...props} />);
    expect(html).toContain('data-loop=""');
    expect(html).toContain('data-autoplay="6000"');
    expect(html).toContain(CAROUSEL_ISLAND_JS);
  });

  it("no autoplay attribute when autoplay is off", () => {
    const html = renderToString(
      <HeroSlider {...heroSliderSchema.parse({ slides: [{ title: "A" }, { title: "B" }] })} />,
    );
    // attribute-exact: the island's own source mentions data-autoplay.
    expect(html).not.toContain("data-autoplay=");
  });

  it("single-slide config renders no arrows at all", () => {
    const html = renderToString(
      <HeroSlider {...heroSliderSchema.parse({ slides: [{ title: "Solo" }] })} />,
    );
    // attribute-exact: the island's own source mentions the selectors.
    expect(html).not.toContain('data-ac-prev=""');
    expect(html).not.toContain('data-ac-next=""');
    expect(html).not.toContain("<button");
  });
});

describe("SSR: testimonial-carousel (D1200)", () => {
  const props = testimonialCarouselSchema.parse({
    heading: "Voices",
    items: [
      { quote: "Quote one", author: "Author One", role: "CEO" },
      { quote: "Quote two", author: "Author Two" },
    ],
    autoplay: true,
    interval_ms: 5000,
  });

  it("every quote + attribution is present in the HTML", () => {
    const html = renderToString(<TestimonialCarousel {...props} />);
    expect(html).toContain("Quote one");
    expect(html).toContain("Quote two");
    expect(html).toContain("Author One");
    expect(html).toContain("Author Two");
    expect(html).toContain("CEO");
  });

  it("scroll-snap viewport + island, arrows never shipped disabled", () => {
    const html = renderToString(<TestimonialCarousel {...props} />);
    expect(html).toContain("data-ac-viewport");
    expect(html).toContain('data-autoplay="5000"');
    expect(html).toContain('data-loop=""');
    expect(html).toContain(CAROUSEL_ISLAND_JS);
    expect(html).not.toContain('disabled=""');
  });

  it("single testimonial: no loop, no arrows", () => {
    const html = renderToString(
      <TestimonialCarousel
        {...testimonialCarouselSchema.parse({ items: [{ quote: "Q", author: "A" }] })}
      />,
    );
    expect(html).not.toContain('data-loop=""');
    expect(html).not.toContain('data-ac-prev=""');
    expect(html).not.toContain('data-ac-next=""');
    expect(html).not.toContain("<button");
  });
});
