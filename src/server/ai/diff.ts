import { isDeepStrictEqual } from "node:util";
import type { Block } from "../../blocks/types.js";

/**
 * Human-readable diff between the current page blocks and a proposed `Block[]`
 * (P6-T6.4). Computed server-side and returned with the proposal so the editor
 * panel (6.6) just renders it. Compares by block `id`:
 *  - added   — id present only in `after`
 *  - removed — id present only in `before`
 *  - updated — same id, props (or children) changed
 *  - moved   — same id, relative order among the COMMON blocks changed
 *              (inserting/removing elsewhere does NOT flag survivors as moved)
 */
export type BlockRef = { id: string; type: string };
export type BlockMove = { id: string; type: string; from: number; to: number };

export type BlockDiff = {
  added: BlockRef[];
  removed: BlockRef[];
  updated: BlockRef[];
  moved: BlockMove[];
  unchanged: number;
  summary: string;
};

export function diffBlocks(before: Block[], after: Block[]): BlockDiff {
  const beforeById = new Map(before.map((b, i) => [b.id, { b, i }]));
  const afterById = new Map(after.map((b, i) => [b.id, { b, i }]));

  // Relative position of each id within the subsequence of blocks that survive
  // in both, so a pure insert/delete elsewhere doesn't mark survivors "moved".
  const commonBeforeOrder = before.filter((b) => afterById.has(b.id)).map((b) => b.id);
  const commonAfterOrder = after.filter((b) => beforeById.has(b.id)).map((b) => b.id);
  const posBefore = new Map(commonBeforeOrder.map((id, i) => [id, i]));
  const posAfter = new Map(commonAfterOrder.map((id, i) => [id, i]));

  const added: BlockRef[] = [];
  const removed: BlockRef[] = [];
  const updated: BlockRef[] = [];
  const moved: BlockMove[] = [];
  let unchanged = 0;

  for (const [id, { b, i }] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) {
      added.push({ id, type: b.type });
      continue;
    }
    const changed =
      !isDeepStrictEqual(prev.b.props, b.props) || !isDeepStrictEqual(prev.b.children, b.children);
    const relMoved = posBefore.get(id) !== posAfter.get(id);
    if (changed) updated.push({ id, type: b.type });
    if (relMoved) moved.push({ id, type: b.type, from: prev.i, to: i });
    if (!changed && !relMoved) unchanged++;
  }

  for (const [id, { b }] of beforeById) {
    if (!afterById.has(id)) removed.push({ id, type: b.type });
  }

  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (updated.length) parts.push(`${updated.length} updated`);
  if (moved.length) parts.push(`${moved.length} moved`);
  const summary = parts.length ? parts.join(", ") : "No changes";

  return { added, removed, updated, moved, unchanged, summary };
}
