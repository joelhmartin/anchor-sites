import { nanoid } from "nanoid";
import { z } from "zod";
import type { Block } from "../../blocks/types.js";
import {
  validateBlocks,
  type BlockShape,
  type ValidationFailure,
} from "../../blocks/validate.js";

/**
 * AI edit-operation contract (P6-T6.3, see DECISIONS D-039).
 *
 * The model expresses page edits as a sequence of small typed ops — NOT by
 * rewriting the whole `Block[]`. An applier turns ops → a new `Block[]`, which
 * is then re-validated against the registry (D-002). Unknown type / invalid
 * props / missing id ⇒ rejected, never applied. This is the safety surface that
 * lets the AI mutate pages (D-001) without ever persisting something the
 * renderer can't render.
 *
 * Scope (v1): ops operate on the TOP-LEVEL block array. Current registered
 * blocks are all leaf blocks (no children exercised — see D-036); nested-children
 * mutation is deferred. `delete_block` removes a block and its subtree.
 */

/** Where to place an inserted/moved block. `after` requires `after_id`. */
const PLACE = z.enum(["start", "end", "after"]);

const newBlockSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.unknown()).default({}),
});

export const insertOpSchema = z.object({
  op: z.literal("insert_block"),
  block: newBlockSchema,
  place: PLACE.default("end"),
  /** Required iff `place === "after"`: id of the existing block to insert after. */
  after_id: z.string().optional(),
});

export const updateOpSchema = z.object({
  op: z.literal("update_block"),
  id: z.string().min(1),
  /** Shallow-merged over the block's current props (send only what changes). */
  props: z.record(z.unknown()),
});

export const deleteOpSchema = z.object({
  op: z.literal("delete_block"),
  id: z.string().min(1),
});

export const moveOpSchema = z.object({
  op: z.literal("move_block"),
  id: z.string().min(1),
  place: PLACE.default("end"),
  after_id: z.string().optional(),
});

export const editOpSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  updateOpSchema,
  deleteOpSchema,
  moveOpSchema,
]);

export type EditOp = z.infer<typeof editOpSchema>;
export const editOpsSchema = z.array(editOpSchema);

export type ApplyFailure = {
  op_index: number;
  op: EditOp["op"];
  reason: "missing_id" | "bad_placement";
  detail: string;
};

export type ApplyResult =
  | { ok: true; blocks: Block[] }
  | { ok: false; failures: ApplyFailure[] };

type Placement = { place: z.infer<typeof PLACE>; after_id?: string };

/**
 * Resolve the array index at which to splice a block in for a placement.
 * Returns -1 when `place === "after"` but `after_id` is missing/unknown.
 */
function resolveInsertIndex(blocks: Block[], { place, after_id }: Placement): number {
  if (place === "start") return 0;
  if (place === "end") return blocks.length;
  // place === "after"
  if (!after_id) return -1;
  const idx = blocks.findIndex((b) => b.id === after_id);
  return idx === -1 ? -1 : idx + 1;
}

/**
 * Apply ops in order to a copy of `blocks`, producing a new `Block[]`.
 * Pure: never mutates the input. Stops at the FIRST failure (ops are sequential
 * — later ops may depend on earlier ones, so cascading past a failure is noise)
 * and returns it; otherwise returns the new blocks. Does NOT validate props —
 * that's `validateBlocks` (call `applyAndValidate` for the full guardrail).
 */
export function applyEditOps(
  blocks: Block[],
  ops: EditOp[],
  opts: { genId?: () => string } = {},
): ApplyResult {
  const genId = opts.genId ?? (() => nanoid());
  const result: Block[] = structuredClone(blocks);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    switch (op.op) {
      case "insert_block": {
        const idx = resolveInsertIndex(result, { place: op.place, after_id: op.after_id });
        if (idx === -1) {
          return failure(i, op.op, "bad_placement", `after_id "${op.after_id ?? ""}" not found`);
        }
        result.splice(idx, 0, { id: genId(), type: op.block.type, props: op.block.props });
        break;
      }
      case "update_block": {
        const target = result.find((b) => b.id === op.id);
        if (!target) return failure(i, op.op, "missing_id", op.id);
        target.props = { ...target.props, ...op.props };
        break;
      }
      case "delete_block": {
        const idx = result.findIndex((b) => b.id === op.id);
        if (idx === -1) return failure(i, op.op, "missing_id", op.id);
        result.splice(idx, 1);
        break;
      }
      case "move_block": {
        const from = result.findIndex((b) => b.id === op.id);
        if (from === -1) return failure(i, op.op, "missing_id", op.id);
        const [moved] = result.splice(from, 1);
        const to = resolveInsertIndex(result, { place: op.place, after_id: op.after_id });
        if (to === -1) {
          return failure(i, op.op, "bad_placement", `after_id "${op.after_id ?? ""}" not found`);
        }
        result.splice(to, 0, moved);
        break;
      }
    }
  }

  return { ok: true, blocks: result };
}

function failure(
  op_index: number,
  op: EditOp["op"],
  reason: ApplyFailure["reason"],
  detail: string,
): ApplyResult {
  return { ok: false, failures: [{ op_index, op, reason, detail }] };
}

export type ProposeResult =
  | { ok: true; blocks: Block[] }
  | { ok: false; stage: "apply"; failures: ApplyFailure[] }
  | { ok: false; stage: "validate"; failures: ValidationFailure[] };

/**
 * The full guardrail (P6-T6.3): apply the ops, then re-validate every resulting
 * block against the registry + Zod schemas. Either stage failing means the
 * proposal is rejected and `blocks` is never produced — so the AI can never
 * yield a `Block[]` the save path would refuse. On success, `blocks` is the
 * proposed page ready for preview (6.4) / save (6.5).
 */
export function applyAndValidate(
  blocks: Block[],
  ops: EditOp[],
  opts: { genId?: () => string } = {},
): ProposeResult {
  const applied = applyEditOps(blocks, ops, opts);
  if (!applied.ok) return { ok: false, stage: "apply", failures: applied.failures };

  const failures = validateBlocks(applied.blocks as BlockShape[]);
  if (failures.length > 0) return { ok: false, stage: "validate", failures };

  return { ok: true, blocks: applied.blocks };
}
