/**
 * Minimal Zod-schema introspection shared across modules that need to see
 * PAST wrapper types (`.default()`/`.optional()`/`.nullable()`/`.refine()`)
 * to the underlying Zod construct, without importing `zod` itself at
 * runtime (this walks `_def` structurally so it stays framework-agnostic).
 *
 * Extracted from the pre-B5 Puck editor's `src/editor/zod-fields.ts` (D-017)
 * when Puck was removed (Task B5, 2026-07-30 lovable-workspace SDD) — this
 * piece has no Puck dependency (it's pure Zod structural walking) and is a
 * real production dependency of `src/blocks/editable-fields.ts` (the inline
 * editor's schema-derived field classifier), so it moved here instead of
 * being deleted with the rest of `src/editor/**`.
 */

// zod's internal defs aren't part of its public types; introspect structurally.
export type ZodLike = { _def?: ZodDef };
export type ZodDef = {
  typeName?: string;
  innerType?: ZodLike;
  schema?: ZodLike;
  type?: ZodLike;
  values?: unknown;
  checks?: Array<{ kind: string; value?: number }>;
  shape?: () => Record<string, ZodLike>;
  defaultValue?: () => unknown;
};

const def = (s: ZodLike): ZodDef => s?._def ?? {};

/** Strip Default/Optional/Nullable/Effects wrappers to the underlying type. */
export function coreType(schema: ZodLike): ZodLike {
  let cur = schema;
  for (let i = 0; i < 20 && cur?._def; i++) {
    const d = def(cur);
    if (d.typeName === "ZodDefault" || d.typeName === "ZodOptional" || d.typeName === "ZodNullable") {
      cur = d.innerType as ZodLike;
    } else if (d.typeName === "ZodEffects") {
      cur = d.schema as ZodLike;
    } else {
      break;
    }
  }
  return cur;
}
