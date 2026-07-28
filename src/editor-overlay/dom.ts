/**
 * DOM lookups for the edit overlay (Inline Editing Task 5).
 *
 * The rendered markup (BlockRenderer.tsx, in editable mode) wraps every
 * block in `<div data-block-id data-block-type>` and every editable prop in
 * `[data-field]` (via `@anchorcorps/components`'s `Editable`). `fields` is
 * the schema-derived classifier map from `src/blocks/editable-fields.ts`:
 * `{ [blockType]: { [field]: FieldKind } }`.
 */

export type FieldKind = "text" | "url" | "image";
export type EditableFieldMap = Record<string, Record<string, FieldKind>>;

/** Nearest ancestor block wrapper's `data-block-id`, or null if none. */
export function blockIdFor(el: Element): string | null {
  return el.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null;
}

/** Nearest ancestor block wrapper's `data-block-type`, or null if none. */
export function blockTypeFor(el: Element): string | null {
  return el.closest("[data-block-type]")?.getAttribute("data-block-type") ?? null;
}

/** Look up the classified FieldKind for a `[data-field]` element, if any. */
export function kindFor(el: Element, fields: EditableFieldMap): FieldKind | undefined {
  const blockType = blockTypeFor(el);
  const field = el.getAttribute("data-field");
  if (!blockType || !field) return undefined;
  return fields[blockType]?.[field];
}

/**
 * Every `[data-field]` element in `root` whose (blockType, field) classifies
 * as `"text"` in `fields` — i.e. the set Task 5's contenteditable activation
 * applies to. `url`/`image` fields (link popover / image picker) are Task 6+.
 */
export function findEditables(fields: EditableFieldMap, root: ParentNode = document): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id] [data-field]"));
  return candidates.filter((el) => kindFor(el, fields) === "text");
}
