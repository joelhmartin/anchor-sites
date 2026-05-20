import type { z } from "zod";
// Type-only imports: this module introspects Zod schemas via `_def` at runtime
// but never imports zod or Puck at runtime, so it (and its tests) run in plain
// node without loading @measured/puck.
import type { Field, Fields } from "./index.js";

/**
 * Generate Puck field config from a block's Zod schema (D-002 / D-017 / D-036).
 * The schema is the single source of editor fields — we never define fields
 * twice. Field VALUES (defaults) are handled separately as `defaultProps` in
 * Config assembly (5.4); this module only produces the field SHAPES.
 *
 * Supported Zod constructs:
 *   - ZodString                 -> text
 *   - ZodNumber (+ min/max)     -> number
 *   - ZodBoolean                -> radio (Yes/No)
 *   - ZodEnum / ZodNativeEnum   -> select
 *   - ZodObject                 -> object (objectFields, recursive)
 *   - ZodArray<ZodObject>       -> array (arrayFields, recursive)
 *   - wrappers ZodDefault / ZodOptional / ZodNullable / ZodEffects are unwrapped
 *
 * Everything else (ZodArray of non-objects, ZodUnion, ZodLiteral, ZodRecord,
 * ZodTuple, ZodAny/Unknown, ZodDate, …) falls back to a `textarea` field — a
 * placeholder so generation never throws. These are the candidates for custom
 * fields in 5.6–5.8 (rich text, image picker, color).
 */

// zod's internal defs aren't part of its public types; introspect structurally.
type ZodLike = { _def?: ZodDef };
type ZodDef = {
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
function coreType(schema: ZodLike): ZodLike {
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

/** "asset_id" -> "Asset Id", "heroSlider" -> "Hero Slider", "cta-label" -> "Cta Label". */
export function humanizeLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function objectFieldsOf(shape: Record<string, ZodLike>): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const [key, child] of Object.entries(shape)) {
    out[key] = fieldFor(child, humanizeLabel(key));
  }
  return out;
}

const fallbackField = (label: string): Field => ({ type: "textarea", label }) as Field;

function fieldFor(schema: ZodLike, label: string): Field {
  const core = coreType(schema);
  const d = def(core);
  switch (d.typeName) {
    case "ZodString":
      return { type: "text", label } as Field;

    case "ZodNumber": {
      const field: { type: "number"; label: string; min?: number; max?: number } = {
        type: "number",
        label,
      };
      for (const check of d.checks ?? []) {
        if (check.kind === "min" && typeof check.value === "number") field.min = check.value;
        if (check.kind === "max" && typeof check.value === "number") field.max = check.value;
      }
      return field as Field;
    }

    case "ZodBoolean":
      return {
        type: "radio",
        label,
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      } as Field;

    case "ZodEnum": {
      const values = (d.values as string[]) ?? [];
      return {
        type: "select",
        label,
        options: values.map((v) => ({ label: humanizeLabel(String(v)), value: v })),
      } as Field;
    }

    case "ZodNativeEnum": {
      const values = Object.values((d.values as Record<string, unknown>) ?? {}).filter(
        (v) => typeof v === "string" || typeof v === "number",
      ) as Array<string | number>;
      return {
        type: "select",
        label,
        options: values.map((v) => ({ label: humanizeLabel(String(v)), value: v })),
      } as Field;
    }

    case "ZodObject": {
      const shape = d.shape?.() ?? {};
      return { type: "object", label, objectFields: objectFieldsOf(shape) } as Field;
    }

    case "ZodArray": {
      const element = coreType(d.type as ZodLike);
      if (def(element).typeName === "ZodObject") {
        const shape = def(element).shape?.() ?? {};
        return { type: "array", label, arrayFields: objectFieldsOf(shape) } as Field;
      }
      // Array of primitives doesn't map onto Puck's array-of-objects model.
      return fallbackField(label);
    }

    default:
      return fallbackField(label);
  }
}

export function zodToPuckFields(schema: z.ZodTypeAny): Fields {
  const core = coreType(schema as unknown as ZodLike);
  if (def(core).typeName !== "ZodObject") return {} as Fields;
  const shape = def(core).shape?.() ?? {};
  return objectFieldsOf(shape) as Fields;
}

/** Resolve a field's `.default(...)` value, seeing through Optional/Nullable/Effects. */
function defaultValueOf(schema: ZodLike): { has: boolean; value?: unknown } {
  let cur = schema;
  for (let i = 0; i < 20 && cur?._def; i++) {
    const d = def(cur);
    if (d.typeName === "ZodDefault") {
      return { has: true, value: d.defaultValue?.() };
    }
    if (d.typeName === "ZodOptional" || d.typeName === "ZodNullable") {
      cur = d.innerType as ZodLike;
    } else if (d.typeName === "ZodEffects") {
      cur = d.schema as ZodLike;
    } else {
      break;
    }
  }
  return { has: false };
}

/**
 * Extract the top-level `.default(...)` values from a block's ZodObject schema,
 * for use as Puck `defaultProps` (the props a freshly-added block starts with).
 * D-002 requires every block field to declare a default, so this is the full
 * starting prop set. Excludes the Puck-reserved `id` (Puck assigns that).
 */
export function zodSchemaDefaults(schema: z.ZodTypeAny): Record<string, unknown> {
  const core = coreType(schema as unknown as ZodLike);
  if (def(core).typeName !== "ZodObject") return {};
  const shape = def(core).shape?.() ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(shape)) {
    const resolved = defaultValueOf(child);
    if (resolved.has) out[key] = resolved.value;
  }
  return out;
}
