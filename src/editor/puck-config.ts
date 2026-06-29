// Side-effect import: registers every block (package blocks + inline rich-text)
// into the shared registry, so the editor's Config reflects exactly what the
// prod renderer renders (D-018 — same components, no editor-only fork).
import { createElement, type ComponentType } from "react";
import "../blocks/index.js";
import { listBlocks } from "../blocks/registry.js";
import { zodToPuckFields, zodSchemaDefaults } from "./zod-fields.js";
import { applyFieldOverrides, type OverrideOpts } from "./field-overrides.js";
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
export function buildPuckConfig(opts: OverrideOpts = {}): Config {
  const components: Record<string, ComponentConfig> = {};

  for (const { type, entry } of listBlocks()) {
    components[type] = {
      label: entry.label,
      // Custom-field overrides (Tiptap rich-text, media picker) replace the
      // schema-derived field for specific props; `siteId` lets the media
      // picker fetch the right library.
      fields: applyFieldOverrides(type, zodToPuckFields(entry.schema), opts),
      defaultProps: zodSchemaDefaults(entry.schema),
      // Blocks with requiresEditorWrapper=true get isEditorPreview=true injected so
      // they can show a safe placeholder in the Puck editor (crm_form: D-006/PHI).
      // All other blocks use the same component reference the prod renderer uses (D-018).
      render: entry.requiresEditorWrapper
        ? (((props: Record<string, unknown>) =>
            createElement(entry.component as ComponentType<Record<string, unknown>>, {
              ...props,
              isEditorPreview: true,
            })) as unknown as ComponentConfig["render"])
        : (entry.component as unknown as ComponentConfig["render"]),
    } as ComponentConfig;
  }

  return { root: {}, components } as unknown as Config;
}
