import { z } from "zod";
import { getBlock } from "./registry.js";
import { sanitizeBlockProps } from "./sanitize.js";

/**
 * Structural shape of one persisted block (D-001). `props` defaults to `{}` so
 * a block with no props still validates structurally; the per-type Zod schema
 * in the registry is what actually validates the props (see `validateBlocks`).
 *
 * Shared by the page save endpoint (`src/server/routes/admin-pages.ts`) and the
 * AI editor (`src/server/ai`) so server + AI run exactly ONE validator — the AI
 * can never persist a block type or props the registry rejects (P6-T6.3).
 *
 * The caller is responsible for having registered the blocks (e.g. via
 * `import "../../blocks/index.js"`); this module is a pure validator.
 */
export const blockShape = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.unknown()).default({}),
  children: z.array(z.unknown()).optional(),
});

export type BlockShape = z.infer<typeof blockShape>;

export type ValidationFailure = {
  index: number;
  id: string;
  type: string;
  reason: "unknown_type" | "invalid_props";
  errors?: { path: string; message: string }[];
};

/**
 * Validate each block against the registry: unknown type → `"unknown_type"`;
 * props that fail the type's Zod schema → `"invalid_props"` with field paths.
 * Returns `[]` when every block is valid.
 *
 * D1109 (W2-SEC) — this gate ALSO SANITIZES free-HTML props IN PLACE
 * (`rich-text`.html, `crm_form`.embed_code — see src/blocks/sanitize.ts for
 * the settled policy) before schema validation. Deliberately a mutation:
 * every write path (admin save, AI edit-ops/create_page, blog+events bodies,
 * git import, template save + seeds) persists the very array it passes here,
 * so sanitizing at the single existing choke point covers them all without
 * touching any call site.
 */
export function validateBlocks(blocks: BlockShape[]): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  blocks.forEach((block, index) => {
    const entry = getBlock(block.type);
    if (!entry) {
      failures.push({ index, id: block.id, type: block.type, reason: "unknown_type" });
      return;
    }
    sanitizeBlockProps(block);
    const parsed = entry.schema.safeParse(block.props);
    if (!parsed.success) {
      failures.push({
        index,
        id: block.id,
        type: block.type,
        reason: "invalid_props",
        errors: parsed.error.errors.map((e) => ({
          path: e.path.join(".") || "(root)",
          message: e.message,
        })),
      });
    }
  });
  return failures;
}
