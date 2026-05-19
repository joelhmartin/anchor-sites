// Importing each block registers it as a side effect (per D-016 +
// PHASE-01 Task 1.3). Order doesn't matter — registerBlock is idempotent
// per type and throws on duplicates.
import "./hero/index.js";
import "./rich-text/index.js";
import "./cta/index.js";

export * from "./types.js";
export { registerBlock, getBlock, listBlocks, hasBlock } from "./registry.js";
