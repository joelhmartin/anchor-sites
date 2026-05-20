/**
 * Editor barrel — the ONE module boundary that imports Puck (D-017).
 *
 * Everything under `src/editor/` imports Puck values + types from here, and
 * nothing OUTSIDE `src/editor/` imports `@measured/puck` at all. That keeps
 * Puck a swappable view layer: our canonical `Block[]` (D-001) stays the source
 * of truth, and the prod renderer never touches Puck.
 *
 * Puck ships its own stylesheet at `@measured/puck/puck.css`; the editor route
 * (5.5) imports it. The Tailwind content glob (`./src/**`) and Vite already
 * cover this directory, so no build config change is needed to bundle it.
 */
export { Puck } from "@measured/puck";

export type {
  Config,
  Data,
  ComponentConfig,
  ComponentData,
  Field,
  Fields,
  Metadata,
} from "@measured/puck";

/**
 * Pinned Puck version. The `Block[]` <-> Puck `Data` conversion contract
 * (D-036, frozen in 5.2) is tied to this exact version — bump deliberately and
 * re-verify the round-trip invariant when you do. Kept in sync with the
 * `@measured/puck` pin in package.json by a smoke test.
 */
export const PUCK_VERSION = "0.20.2";
