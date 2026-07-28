/**
 * Rich-text HTML allowlist sanitizer (Inline Editing Task 6).
 *
 * Runs client-side, in the sandboxed preview iframe, on every outbound
 * `field-edit` for the rich-text block's `html` field — defense in depth
 * only; Studio/the server re-sanitize on the way in (never trust the wire),
 * but a compromised/buggy contenteditable implementation shouldn't be able
 * to smuggle a `<script>` even one hop.
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
    const tag = el.tagName;

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
