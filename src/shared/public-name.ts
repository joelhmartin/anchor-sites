/**
 * D911 — seed/placeholder markers must never reach an indexable public
 * surface. Provisioning and seeds sometimes name sites with an explicit
 * marker — e.g. "Muldoon Dental (placeholder)" — and that string flowed
 * verbatim into og:site_name, Organization/WebSite JSON-LD, page titles and
 * the rendered header/footer of live, index,follow pages (verified live).
 *
 * The render-time strip lives here (shared, dependency-free) so both sides
 * use ONE definition of "marker":
 *   - the tenant resolver strips it from every public render path, and
 *   - the Studio detects it to nudge the operator to rename (the honest
 *     fix is a real name; the strip just keeps the marker off live pages
 *     until then).
 *
 * Deliberately narrow: only the literal "(placeholder)" parenthetical is a
 * marker. Anything broader (e.g. "(test)") would eat real names.
 */

const MARKER = /\(\s*placeholder\s*\)/gi;

/** True when a display name still carries a seed placeholder marker. */
export function hasPlaceholderMarker(name: string): boolean {
  return new RegExp(MARKER.source, "i").test(name);
}

/**
 * The name a public visitor should see: marker stripped, whitespace
 * collapsed. Falls back to the slug when the name was nothing BUT marker.
 */
export function publicDisplayName(name: string, slug: string): string {
  const stripped = name.replace(MARKER, " ").replace(/\s+/g, " ").trim();
  return stripped || slug;
}
