/**
 * Block registration for the renderer.
 *
 * After Phase 2 Task 2.8, all visible page blocks are sourced from the
 * versioned `@anchorcorps/components` package (D-005). The renderer
 * supplies its own `registerBlock` to the package's manifest, so the
 * package never imports this registry (D-016).
 *
 * `rich-text` remains an inline block here pending Phase 5 (Tiptap +
 * Puck editor). Once Tiptap moves into the package, this file collapses
 * to just the `registerAll` call.
 */

import { blockManifest } from "@anchorcorps/components";
import { registerBlock } from "./registry.js";

// Register every block from the package.
for (const entry of blockManifest) {
  const { type, ...rest } = entry;
  registerBlock(type, rest);
}

// Side-effect import — registers `rich-text` against the same registry.
import "./rich-text/index.js";

export * from "./types.js";
export { registerBlock, getBlock, listBlocks, hasBlock } from "./registry.js";
