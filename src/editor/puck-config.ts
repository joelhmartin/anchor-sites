// Side-effect import: registers every block (package blocks + inline rich-text)
// into the shared registry, so the editor's Config reflects exactly what the
// prod renderer renders (D-018 — same components, no editor-only fork).
import "../blocks/index.js";
import { listBlocks } from "../blocks/registry.js";
import { zodToPuckFields, zodSchemaDefaults } from "./zod-fields.js";
import { fieldOverridesFor } from "./field-overrides.js";
// Type-only Puck imports keep this module free of a runtime Puck dependency.
import type { ComponentConfig, Config } from "./index.js";

/**
 * Assemble a Puck `Config` from the block registry (D-017 / D-036).
 *
 * Every registered block type → one Puck component entry:
 *   - `fields`       from `zodToPuckFields(schema)` (D-002 — fields derive from
 *                    the Zod schema, never defined twice).
 *   - `defaultProps` from `zodSchemaDefaults(schema)` (a new block's starting props).
 *   - `render`       is the SAME component the prod renderer uses.
 *
 * Because it reads the shared registry, plugin-registered blocks (D-016) appear
 * automatically with no editor changes. Purely a data assembly — builds a plain
 * object, so no Puck runtime is loaded here.
 */
export function buildPuckConfig(): Config {
  const components: Record<string, ComponentConfig> = {};

  for (const { type, entry } of listBlocks()) {
    components[type] = {
      label: entry.label,
      // Custom-field overrides (e.g. Tiptap for rich-text.html) win over the
      // schema-derived field for the same prop.
      fields: { ...zodToPuckFields(entry.schema), ...fieldOverridesFor(type) },
      defaultProps: zodSchemaDefaults(entry.schema),
      render: entry.component as unknown as ComponentConfig["render"],
    } as ComponentConfig;
  }

  return { root: {}, components } as unknown as Config;
}
