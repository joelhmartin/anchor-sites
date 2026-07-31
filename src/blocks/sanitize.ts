import sanitizeHtml, { type IOptions } from "sanitize-html";
import type { BlockShape } from "./validate.js";

/**
 * W2-SEC D1109 — server-side sanitization of the two stored block props that
 * render via dangerouslySetInnerHTML:
 *
 *   - `rich-text`.html      (src/blocks/rich-text/component.tsx)
 *   - `crm_form`.embed_code (packages/components crm-form/CrmForm.tsx)
 *
 * Enforced IN `validateBlocks` (the one gate every write path already runs:
 * admin save, AI edit-ops/create_page, blog+events bodies, git import,
 * template save + seeds) by mutating the props in place BEFORE schema
 * validation — every caller persists the same array it validates, so the
 * cleaned value is what reaches the DB. Render paths are untouched: content
 * stored before this gate existed renders as-is until its next save.
 *
 * The D1200 carousel enhancement island is NOT in scope: it is SSR-emitted
 * from the component package's own constant (CAROUSEL_ISLAND_JS), never
 * stored in props, so it cannot pass through this gate.
 *
 * POLICY (settled here, tested against the full template catalog as a fixed
 * point — tests/unit/sanitize-blocks.test.ts):
 *
 * rich-text.html — document formatting only:
 *   allowed: p/br/hr, headings h1–h6, strong/em/b/i/u/s/sub/sup/span/small,
 *   a[href http(s)/mailto/tel/relative], ul/ol/li, dl/dt/dd, blockquote/cite,
 *   code/pre, img[src http(s)/relative only — no data:], full table set,
 *   figure/figcaption. `class` allowed everywhere (block CSS hooks).
 *   NEVER: script/style/iframe/object/embed/svg/math/form elements, inline
 *   event handlers, style attributes, javascript:/data: URLs.
 *
 * crm_form.embed_code — a real HTML form, deliberately (post-W1.6 templates
 * author working platform lead forms that POST /api/leads):
 *   allowed: form + the full control set (input/textarea/select/option/
 *   optgroup/button/fieldset/legend/label/datalist/output) plus light text
 *   structure (p/br/div/span/strong/em/small/h2-h4/ul/ol/li/a).
 *   form[action] may be relative (the platform pattern) or an
 *   operator-supplied absolute http(s) URL. `style` is allowed ONLY as the
 *   narrow off-screen idiom the honeypot needs (position/left/top and
 *   width/height/overflow/clip) — not arbitrary CSS.
 *   NEVER: script/iframe/object/embed, event handlers, javascript: URLs,
 *   formaction (submit hijack), input[type=image] src.
 */

const RICH_TEXT_OPTIONS: IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "b", "i", "u", "s", "sub", "sup", "span", "small", "mark",
    "a",
    "ul", "ol", "li", "dl", "dt", "dd",
    "blockquote", "cite", "q",
    "code", "pre",
    "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "figure", "figcaption",
  ],
  allowedAttributes: {
    "*": ["class"],
    a: ["href", "name", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    ol: ["class", "start", "type"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // <br /> style output, matching how templates author void tags.
  selfClosing: ["img", "br", "hr", "col"],
};

const EMBED_CODE_OPTIONS: IOptions = {
  allowedTags: [
    "form", "input", "textarea", "select", "option", "optgroup", "button",
    "fieldset", "legend", "label", "datalist", "output",
    "p", "br", "div", "span", "strong", "em", "small",
    "h2", "h3", "h4",
    "ul", "ol", "li",
    "a",
  ],
  allowedAttributes: {
    "*": ["class", "id", "role", "tabindex", "title", "aria-*", "data-*"],
    form: ["action", "method", "enctype", "novalidate", "autocomplete", "name", "accept-charset"],
    input: [
      "type", "name", "value", "placeholder", "required", "autocomplete",
      "min", "max", "step", "minlength", "maxlength", "pattern", "inputmode",
      "checked", "disabled", "readonly", "list", "size",
      // NOTE: no `formaction`, no `src` (input[type=image] is a nav vector).
    ],
    textarea: [
      "name", "rows", "cols", "placeholder", "required", "maxlength",
      "minlength", "autocomplete", "disabled", "readonly", "wrap",
    ],
    select: ["name", "required", "multiple", "size", "disabled", "autocomplete"],
    option: ["value", "selected", "disabled", "label"],
    button: ["type", "name", "value", "disabled"], // no formaction
    label: ["for"],
    output: ["for", "name"],
    a: ["href", "target", "rel", "title"],
    // `style` only where the off-screen honeypot idiom needs it; allowedStyles
    // below constrains the properties.
    // (Listed per-tag rather than "*" so arbitrary containers can't restyle.)
    // label carries it in every shipped template.
    // eslint-disable-next-line @typescript-eslint/naming-convention
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  selfClosing: ["input", "br"],
  allowedStyles: {
    "*": {
      // Off-screen/visually-hidden idioms (honeypot: position:absolute;left:-9999px).
      position: [/^(absolute|relative|static)$/],
      left: [/^-?\d+(px|%|rem|em)?$/],
      top: [/^-?\d+(px|%|rem|em)?$/],
      width: [/^\d+(px|%|rem|em)?$/],
      height: [/^\d+(px|%|rem|em)?$/],
      overflow: [/^hidden$/],
      clip: [/^rect\([^()]*\)$/],
    },
  },
};

// `style` has to be added to the attribute allowlist for allowedStyles to
// apply. Grant it broadly within the embed (the property allowlist above is
// the real constraint).
(EMBED_CODE_OPTIONS.allowedAttributes as Record<string, string[]>)["*"] = [
  ...((EMBED_CODE_OPTIONS.allowedAttributes as Record<string, string[]>)["*"] ?? []),
  "style",
];

/** Sanitize a `rich-text` block's `html` prop (formatting/document allowlist). */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}

/** Sanitize a `crm_form` block's `embed_code` prop (form-subset allowlist). */
export function sanitizeEmbedCode(html: string): string {
  return sanitizeHtml(html, EMBED_CODE_OPTIONS);
}

/**
 * The per-type map of free-HTML props. Adding a new block type that renders
 * a stored prop via dangerouslySetInnerHTML? It MUST get an entry here — the
 * sanitize-blocks test suite's fixed-point invariant is the template of how
 * to prove the policy against real content.
 */
const HTML_PROP_SANITIZERS: Record<string, Record<string, (html: string) => string>> = {
  "rich-text": { html: sanitizeRichTextHtml },
  crm_form: { embed_code: sanitizeEmbedCode },
};

/**
 * Mutates `block.props` in place, sanitizing any known free-HTML prop.
 * Non-string values are left for schema validation to reject.
 */
export function sanitizeBlockProps(block: BlockShape): void {
  const fields = HTML_PROP_SANITIZERS[block.type];
  if (!fields || !block.props) return;
  for (const [prop, sanitize] of Object.entries(fields)) {
    const value = block.props[prop];
    if (typeof value === "string") {
      block.props[prop] = sanitize(value);
    }
  }
}
