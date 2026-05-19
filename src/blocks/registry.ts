import type { z } from "zod";
import type { BlockRegistryEntry } from "./types.js";

/**
 * Runtime block registry (D-016).
 *
 * Static blocks in `src/blocks/<type>/index.ts` call `registerBlock` at
 * module load. Plugins (Phase 7.5) call the same function from their
 * manifest's load step — same API, no plugin-specific path.
 *
 * Do not export the underlying Map. Mutations go through `registerBlock`
 * (which enforces uniqueness); reads go through `getBlock` / `listBlocks`.
 */
const registry = new Map<string, BlockRegistryEntry>();

export function registerBlock<T extends z.ZodTypeAny>(
  type: string,
  entry: BlockRegistryEntry<T>,
): void {
  if (registry.has(type)) {
    throw new Error(`Block type already registered: ${type}`);
  }
  registry.set(type, entry as BlockRegistryEntry);
}

export function getBlock(type: string): BlockRegistryEntry | undefined {
  return registry.get(type);
}

export function listBlocks(): Array<{ type: string; entry: BlockRegistryEntry }> {
  return [...registry.entries()].map(([type, entry]) => ({ type, entry }));
}

export function hasBlock(type: string): boolean {
  return registry.has(type);
}

/**
 * Test-only escape hatch. Resets the registry between tests so cross-test
 * order doesn't matter. Do not call from production code.
 */
export function __resetRegistryForTests(): void {
  registry.clear();
}

// Phase 6 helper (zod-to-json-schema → AI prompt) will live alongside this
// file once the AI editor lands. Schemas are already the source of truth.
