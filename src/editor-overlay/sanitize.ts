/**
 * Rich-text HTML allowlist sanitizer (Inline Editing Task 6).
 *
 * Runs client-side, in the sandboxed preview iframe, on every outbound
 * `field-edit` for the rich-text block's `html` field. This is currently
 * the PRIMARY defense — there is no server-side HTML sanitizer in this
 * codebase; the server's Zod validation for the rich-text block only checks
 * that `html` is a string (see `src/blocks/rich-text/schema.ts`). Until a
 * server-side pass exists, a bug or bypass here reaches the wire unfiltered,
 * so treat changes to the allowlist/removal rules below as security-
 * sensitive.
 *
 * DOMParser-based allowlist walk:
 *   - Allowed tags (`ALLOWED_TAGS`) are kept; all attributes are stripped
 *     EXCEPT `A`'s `href`, which survives only if it matches `^https?:`
 *     (rejects `javascript:`, `data:`, bare `#`, relative paths, etc.).
 *   - `SCRIPT`/`STYLE`/`IFRAME` are removed entirely (element + children).
 *   - Any other disallowed element is unwrapped: its children are kept (and
 *     have already been sanitized) but the element itself is discarded.
 *   - Comment nodes and anything else that isn't a text or element node are
 *     dropped.
 *   - Tag-name matching is done on `tagName.toUpperCase()`, not raw
 *     `tagName`. `DOMParser`'s HTML parser puts SVG/MathML foreign-content
 *     subtrees (`<svg>`, `<math>`, and everything nested inside them) in
 *     their own namespace with LOWERCASE `tagName`s that preserve author
 *     casing (e.g. `<svg><script>` yields a nested element whose `tagName`
 *     is literally `"script"`, not `"SCRIPT"`). Comparing that raw casing
 *     against the (uppercase) `ALLOWED_TAGS`/`REMOVED_ENTIRELY` sets would
 *     make it miss `REMOVED_ENTIRELY`, fall through to "disallowed", and
 *     get unwrapped — leaking the script's raw text into the sanitized
 *     output. Normalizing both lookups closes that hole regardless of
 *     namespace/casing.
 */

const ALLOWED_TAGS = new Set([
  "P",
  "B",
  "I",
  "STRONG",
  "EM",
  "A",
  "UL",
  "OL",
  "LI",
  "BR",
  "H2",
  "H3",
]);

const REMOVED_ENTIRELY = new Set(["SCRIPT", "STYLE", "IFRAME"]);

const SAFE_HREF = /^https?:/i;

function sanitizeChildren(parent: ParentNode): void {
  // Snapshot first — we mutate (remove/unwrap) nodes as we walk siblings.
  const nodes = Array.from(parent.childNodes);
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) continue;

    if (node.nodeType !== Node.ELEMENT_NODE) {
      parent.removeChild(node);
      continue;
    }

    const el = node as Element;
    // Normalize casing — see module docblock (SVG/MathML foreign-content
    // tagNames preserve author casing, e.g. lowercase "script").
    const tag = el.tagName.toUpperCase();

    if (REMOVED_ENTIRELY.has(tag)) {
      el.remove();
      continue;
    }

    // Clean grandchildren before deciding whether to keep/unwrap this node.
    sanitizeChildren(el);

    if (!ALLOWED_TAGS.has(tag)) {
      const target = el.parentNode;
      if (target) {
        while (el.firstChild) target.insertBefore(el.firstChild, el);
        target.removeChild(el);
      }
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      if (tag === "A" && attr.name === "href" && SAFE_HREF.test(attr.value)) continue;
      el.removeAttribute(attr.name);
    }
  }
}

/** Allowlist-sanitize a rich-text HTML string. See module docblock for rules. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}
