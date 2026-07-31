import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaProvider } from "@anchorcorps/components";
import { BlockRenderer } from "../../src/components/BlockRenderer.js";
import type { Block } from "../../src/blocks/types.js";
// Side-effect: register every block against the live registry.
import "../../src/blocks/index.js";
import { allTemplates } from "./index.js";

/**
 * D1200 — catalog-wide SSR render invariants for the interactive blocks.
 *
 * Every seeded template page is rendered exactly the way the tenant renderer
 * does (BlockRenderer + renderToString, empty media context) and the D1200
 * contract is asserted on the raw HTML: FAQ answers must be present (native
 * details/summary), carousels must ship a scroll-snap viewport and never a
 * disabled arrow. Because this walks ALL templates, a future template (or a
 * block regression) that reintroduces promise-but-don't-deliver
 * interactivity fails here, not in production.
 */

/** Mirror React's escapeTextForBrowser so raw template copy can be matched in SSR output. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderBlocks(blocks: Block[]): string {
  return renderToString(
    <MediaProvider assets={[]}>
      <BlockRenderer blocks={blocks} />
    </MediaProvider>,
  );
}

describe("template catalog SSR render invariants (D1200)", () => {
  for (const t of allTemplates) {
    for (const page of t.pages) {
      const blocks = page.blocks as Block[];
      const types = new Set(blocks.map((b) => b.type));
      const hasInteractive =
        types.has("faq-accordion") || types.has("hero-slider") || types.has("testimonial-carousel");
      if (!hasInteractive) continue;

      it(`${t.slug}/${page.slug}: interactive blocks render complete, never-dead SSR HTML`, () => {
        const html = renderBlocks(blocks);
        // Nothing fell through to the error/unknown placeholder.
        expect(html).not.toContain("Unknown block");
        expect(html).not.toContain("failed validation");

        for (const b of blocks) {
          if (b.type === "faq-accordion") {
            const items = (b.props as { items?: { question: string; answer: string }[] }).items ?? [];
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
              expect(html, `${t.slug}/${page.slug} FAQ answer`).toContain(esc(item.answer));
            }
            expect(html).toContain("<details");
            expect(html).toContain("<summary");
          }
          if (b.type === "hero-slider" || b.type === "testimonial-carousel") {
            expect(html).toContain("data-ac-viewport");
            // The Embla-era bug: arrows SSR'd permanently disabled.
            expect(html).not.toContain('disabled=""');
          }
        }
      });
    }
  }
});
