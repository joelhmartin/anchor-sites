/**
 * W2-SEC D1109 — server-side sanitization of free-HTML block props at the
 * ONE validation gate (validateBlocks).
 *
 * Two stored props render via dangerouslySetInnerHTML:
 *   - `rich-text`.html      → formatting/document allowlist (no forms)
 *   - `crm_form`.embed_code → form-subset allowlist (no script/iframe ever;
 *                             post-W1.6 templates author REAL platform lead
 *                             forms here, so form controls must survive)
 *
 * The D1200 carousel island is SSR-emitted from the component's own constant
 * (CAROUSEL_ISLAND_JS), never stored in props — it does not pass through
 * this gate (asserted below).
 *
 * Survival invariant: every shipped template's rich-text html and crm_form
 * embed_code must round-trip BYTE-IDENTICAL through the sanitizer — the
 * policy is proven against the real catalog, not a toy fixture.
 */
import { describe, expect, it } from "vitest";
import {
  sanitizeEmbedCode,
  sanitizeRichTextHtml,
} from "../../src/blocks/sanitize.js";
import { validateBlocks, type BlockShape } from "../../src/blocks/validate.js";
import "../../src/blocks/index.js"; // register block types for validateBlocks
import { allTemplates } from "../../db/templates/index.js";

describe("sanitizeRichTextHtml (D1109)", () => {
  it("strips <script> entirely (tag AND content)", () => {
    const out = sanitizeRichTextHtml('<p>hi</p><script>alert("x")</script>');
    expect(out).toBe("<p>hi</p>");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeRichTextHtml('<p onclick="steal()">hi</p><img src="https://x.test/a.jpg" onerror="p()" />');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onerror");
    expect(out).toContain("<p>hi</p>");
  });

  it("strips javascript: URLs but keeps http(s)/mailto/tel/relative links", () => {
    expect(sanitizeRichTextHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    expect(sanitizeRichTextHtml('<a href="https://a.test/b">x</a>')).toContain('href="https://a.test/b"');
    expect(sanitizeRichTextHtml('<a href="/contact">x</a>')).toContain('href="/contact"');
    expect(sanitizeRichTextHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
    expect(sanitizeRichTextHtml('<a href="tel:+14235550198">x</a>')).toContain('href="tel:+14235550198"');
  });

  it("strips style/iframe/object/form elements from rich text", () => {
    const out = sanitizeRichTextHtml(
      '<style>p{}</style><iframe src="https://evil.test"></iframe><object></object><form action="/x"><input name="a" /></form><p>keep</p>',
    );
    expect(out).toBe("<p>keep</p>");
  });

  it("keeps document structure: headings, lists, tables, blockquote/cite, strong/em, br", () => {
    const src =
      "<h2>H</h2><ul><li><strong>a</strong></li></ul><table><thead><tr><th>c</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table><blockquote>q<cite>who</cite></blockquote><p>x<br />y</p>";
    expect(sanitizeRichTextHtml(src)).toBe(src);
  });

  it("keeps img with http(s) src but drops data:/javascript: srcs", () => {
    expect(sanitizeRichTextHtml('<img src="https://img.test/a.jpg" alt="a" />')).toBe(
      '<img src="https://img.test/a.jpg" alt="a" />',
    );
    expect(sanitizeRichTextHtml('<img src="data:text/html;base64,xxx" />')).not.toContain("data:");
  });
});

describe("sanitizeEmbedCode (D1109 — crm_form policy)", () => {
  const PLATFORM_FORM =
    '<form action="/api/leads" method="post" class="acme-contact-form">' +
    '<input type="hidden" name="_page" value="/contact" />' +
    '<label style="position:absolute;left:-9999px" aria-hidden="true">Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>' +
    "<label>Name<input type=\"text\" name=\"name\" required /></label>" +
    '<label>Message<textarea name="message" rows="4"></textarea></label>' +
    '<button type="submit">Send</button>' +
    "</form>";

  it("the platform lead-form pattern survives byte-identical (incl. honeypot style)", () => {
    expect(sanitizeEmbedCode(PLATFORM_FORM)).toBe(PLATFORM_FORM);
  });

  it("never allows script/iframe, even inside an otherwise-valid form", () => {
    const out = sanitizeEmbedCode(
      '<form action="/api/leads" method="post"><script>x()</script><iframe src="https://x.test"></iframe><input name="a" /></form>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<iframe");
    expect(out).toContain('<input name="a" />');
  });

  it("strips event handlers and javascript: action", () => {
    const out = sanitizeEmbedCode(
      '<form action="javascript:steal()" method="post" onsubmit="x()"><input name="a" onfocus="y()" /></form>',
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("onsubmit");
    expect(out).not.toContain("onfocus");
  });

  it("strips formaction (a submit-hijack vector) from buttons/inputs", () => {
    const out = sanitizeEmbedCode(
      '<form action="/api/leads" method="post"><button type="submit" formaction="https://evil.test">Go</button></form>',
    );
    expect(out).not.toContain("formaction");
  });

  it("allows an operator-supplied external https form action (documented policy)", () => {
    const out = sanitizeEmbedCode('<form action="https://crm.example.com/capture" method="post"><input name="a" /></form>');
    expect(out).toContain('action="https://crm.example.com/capture"');
  });
});

describe("validateBlocks sanitizes free-HTML props in place (the choke point)", () => {
  it("cleans rich-text html before the props reach persistence", () => {
    const block: BlockShape = {
      id: "b1",
      type: "rich-text",
      props: { html: '<p>ok</p><script>alert(1)</script>' },
    };
    const failures = validateBlocks([block]);
    expect(failures).toEqual([]);
    expect(block.props.html).toBe("<p>ok</p>");
  });

  it("cleans crm_form embed_code before the props reach persistence", () => {
    const block: BlockShape = {
      id: "b2",
      type: "crm_form",
      props: {
        embed_code: '<form action="/api/leads" method="post"><input name="a" onblur="x()" /></form>',
      },
    };
    const failures = validateBlocks([block]);
    expect(failures).toEqual([]);
    expect(block.props.embed_code).not.toContain("onblur");
    expect(block.props.embed_code).toContain('<input name="a" />');
  });

  it("leaves non-string values to schema validation (no crash, no coercion)", () => {
    const block: BlockShape = { id: "b3", type: "rich-text", props: { html: 42 } };
    const failures = validateBlocks([block]);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBe("invalid_props");
  });

  it("does not touch blocks whose SSR emits its own inline script (carousel island is not a prop)", () => {
    const block: BlockShape = {
      id: "b4",
      type: "testimonial-carousel",
      props: { title: "T", testimonials: [{ quote: "q", name: "n" }] },
    };
    const before = JSON.stringify(block.props);
    validateBlocks([block]);
    expect(JSON.stringify(block.props)).toBe(before);
  });
});

describe("survival invariant — the whole shipped template catalog is a fixed point", () => {
  // Templates spell void tags both ways (`<br>` and `<br />`); the sanitizer
  // serializes them uniformly as `<tag />`. That spelling is the ONLY change
  // tolerated — normalize it on both sides, then require byte-identity, plus
  // idempotence (a second pass changes nothing, so repeated saves converge
  // after the first).
  const normVoid = (s: string) => s.replace(/\s*\/>/g, ">");

  for (const t of allTemplates) {
    it(`${t.slug}: every rich-text html and crm_form embed_code survives (modulo void-tag spelling)`, () => {
      for (const page of t.pages) {
        for (const block of page.blocks as { id: string; type: string; props: Record<string, unknown> }[]) {
          if (block.type === "rich-text" && typeof block.props.html === "string") {
            const out = sanitizeRichTextHtml(block.props.html);
            expect(normVoid(out), `${t.slug}/${page.slug}#${block.id} html`).toBe(
              normVoid(block.props.html),
            );
            expect(sanitizeRichTextHtml(out), `${t.slug}/${page.slug}#${block.id} html idempotence`).toBe(out);
          }
          if (block.type === "crm_form" && typeof block.props.embed_code === "string") {
            const out = sanitizeEmbedCode(block.props.embed_code);
            expect(normVoid(out), `${t.slug}/${page.slug}#${block.id} embed_code`).toBe(
              normVoid(block.props.embed_code),
            );
            expect(sanitizeEmbedCode(out), `${t.slug}/${page.slug}#${block.id} embed idempotence`).toBe(out);
          }
        }
      }
    });
  }
});
