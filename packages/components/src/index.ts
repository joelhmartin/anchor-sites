/**
 * @anchorcorps/components — public entrypoint.
 *
 * Exports:
 *   - `VERSION` — runtime version string (matches package.json)
 *   - `blockManifest` — array of block entries the renderer iterates and
 *     registers via its own `registerBlock(type, entry)` function (D-016)
 *   - `registerAll` — convenience helper that takes the renderer's
 *     `registerBlock` and invokes it once per manifest entry
 *   - `BlockManifestEntry` — type contract the renderer's
 *     `BlockRegistryEntry` is compatible with
 *
 * Internal layers (shadcn primitives) are NOT exported from this entry —
 * opinionated blocks consume them inside the package only.
 */

export const VERSION = "0.6.0";

export { blockManifest, registerAll } from "./blocks/manifest.js";
export type { BlockManifestEntry, RegisterBlockFn } from "./blocks/manifest.js";

// Media hydration surface (P3-T3.12).
export {
  MediaContext,
  MediaProvider,
  useMediaContext,
  type MediaAssetData,
  type MediaContextValue,
  type MediaVariant,
} from "./media-context.js";

// Inline-editing surface (P?-inline-editing Task 2).
export { Editable, EditModeContext, EditModeProvider, type EditableProps } from "./editable.js";

// D1200 — the carousel enhancement island source. Exported so consumers
// embedding SSR output under a restrictive CSP can allow exactly this
// script by hash (the renderer's preview routes do:
// `'sha256-' + base64(sha256(CAROUSEL_ISLAND_JS))`). Exact-string stable;
// see src/primitives/carousel-island.ts for the contract.
export { CAROUSEL_ISLAND_JS } from "./primitives/carousel-island.js";
