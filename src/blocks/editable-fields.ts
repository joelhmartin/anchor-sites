import { listBlocks } from "./registry.js";
import { coreType, type ZodLike } from "./zod-introspect.js";
import type { Block } from "./types.js";

/**
 * Schema-derived editable-field classifier (Inline Editing Task 3).
 *
 * Walks every registered block's Zod schema (same registry-walk pattern as
 * `src/server/ai/catalog.ts`) and classifies each TOP-LEVEL shape entry into
 * a `FieldKind` the inline editor knows how to render an affordance for.
 * Nothing recurses into arrays or nested objects — only bare top-level
 * strings are eligible, per the classification rules below.
 *
 * Classification (exact):
 *   1. Name matches `/asset_id$/`                          -> "image"
 *   2. ZodString with a `.url()` check, OR name matches
 *      `/(^|_)(url|href|link)$/`                            -> "url"
 *   3. Any other bare ZodString (not ZodEnum, not nested
 *      inside an array/object)                              -> "text"
 *   4. Everything else (enum, number, boolean, array,
 *      object, ...) is excluded from the map entirely.
 */
export type FieldKind = "text" | "url" | "image";
export type EditableFieldMap = Record<string, Record<string, FieldKind>>;

const ASSET_ID_NAME = /asset_id$/;
const URL_LIKE_NAME = /(^|_)(url|href|link)$/;

function classifyField(name: string, schema: ZodLike): FieldKind | undefined {
  const core = coreType(schema);
  if (core?._def?.typeName !== "ZodString") return undefined;

  if (ASSET_ID_NAME.test(name)) return "image";

  const hasUrlCheck = (core._def?.checks ?? []).some((c) => c.kind === "url");
  if (hasUrlCheck || URL_LIKE_NAME.test(name)) return "url";

  return "text";
}

/**
 * Build the full blockType -> field -> FieldKind map from the live block
 * registry. Every registered block type gets an entry (possibly `{}` if it
 * has no editable fields, e.g. a block whose only top-level field is an
 * array) so callers can rely on `map[type]` always being defined.
 */
export function buildEditableFieldMap(): EditableFieldMap {
  const map: EditableFieldMap = {};
  for (const { type, entry } of listBlocks()) {
    const schema = entry.schema as unknown as ZodLike;
    const shape = schema._def?.typeName === "ZodObject" ? (schema._def.shape?.() ?? {}) : {};
    const fields: Record<string, FieldKind> = {};
    for (const [key, child] of Object.entries(shape)) {
      const kind = classifyField(key, child);
      if (kind) fields[key] = kind;
    }
    map[type] = fields;
  }
  return map;
}

/**
 * Task 7 — the overlay's link chip needs the CURRENT value of every
 * `url`-classified field to hand Studio's link popover a starting value
 * (the overlay only sees rendered markup, not prop values for fields that
 * have no `[data-field]` DOM node of their own, e.g. a `cta_href` that
 * drives an `<a href>` but isn't itself rendered as editable text). Built
 * server-side, once per preview request, from the page's actual blocks +
 * the same classifier map bootData already sends — never recomputed
 * client-side.
 *
 * Only string prop values are included (a `url`-classified field is always
 * a ZodString per `classifyField`, but stored props are `unknown` — a
 * corrupt/legacy value of the wrong type is silently skipped rather than
 * coerced).
 *
 * `block.props` itself can be null/undefined on a legacy row or a direct DB
 * edit — guard it the same way `collectAssetIds` does in
 * `src/server/render-hydration.ts:20` rather than indexing it unguarded and
 * 500ing the whole edit-mode preview.
 */
export function buildUrlValues(blocks: Block[], fields: EditableFieldMap): Record<string, Record<string, string>> {
  const urls: Record<string, Record<string, string>> = {};
  for (const block of blocks) {
    const blockFields = fields[block.type];
    if (!blockFields) continue;
    const props = (block.props ?? {}) as Record<string, unknown>;
    const entries: Record<string, string> = {};
    for (const [field, kind] of Object.entries(blockFields)) {
      if (kind !== "url") continue;
      const value = props[field];
      if (typeof value === "string") entries[field] = value;
    }
    if (Object.keys(entries).length > 0) urls[block.id] = entries;
  }
  return urls;
}
