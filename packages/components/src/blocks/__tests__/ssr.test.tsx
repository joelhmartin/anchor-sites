import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FaqAccordion } from "../faq-accordion/component.js";
import { faqAccordionSchema } from "../faq-accordion/schema.js";

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
