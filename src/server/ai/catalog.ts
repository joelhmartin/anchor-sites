import { zodToJsonSchema } from "zod-to-json-schema";
import { listBlocks } from "../../blocks/registry.js";
// Side-effect: register the static blocks before we read them (mirrors
// src/server/routes/admin-pages.ts). Plugin blocks (D-016) that register at
// load appear automatically — the catalog is whatever the registry holds.
import "../../blocks/index.js";

/**
 * One block as the AI sees it (P6-T6.2). Zod stays the single source of truth
 * (D-002): `zod-to-json-schema` derives the prop schema the model must obey,
 * and `description` / `aiHints` steer it. The catalog is the *stable* prefix of
 * the AI prompt (system + catalog) that gets prompt-cached in 6.7 — so it must
 * be deterministic.
 */
export type BlockCatalogEntry = {
  type: string;
  label: string;
  description: string;
  aiHints?: string;
  category: string;
  /** JSON Schema (draft-07) derived from the block's Zod schema. */
  jsonSchema: Record<string, unknown>;
};

/**
 * Turn the live block registry into the AI's catalog. Order follows
 * registration order (Map insertion) so the serialized catalog is byte-stable
 * across requests — a hard requirement for the prompt cache (6.7). `$refStrategy:
 * "none"` inlines every sub-schema (our blocks aren't recursive) so the model
 * sees self-contained prop schemas with no `$ref` indirection to resolve.
 */
export function buildBlockCatalog(): BlockCatalogEntry[] {
  return listBlocks().map(({ type, entry }) => {
    const jsonSchema = zodToJsonSchema(entry.schema, {
      $refStrategy: "none",
    }) as Record<string, unknown>;
    return {
      type,
      label: entry.label,
      description: entry.description,
      category: entry.category,
      ...(entry.aiHints ? { aiHints: entry.aiHints } : {}),
      jsonSchema,
    };
  });
}
