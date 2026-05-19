import type { ComponentType } from "react";
import type { z } from "zod";

/**
 * Shape of one entry in the package's block manifest. Designed to be
 * structurally compatible with the renderer's `BlockRegistryEntry`
 * (`src/blocks/types.ts`) so the renderer can register entries directly
 * without an adapter layer.
 *
 * Schema is the contract (D-002). Component is a pure function of props.
 * Root element MUST use the `ac-<type>` class prefix (D-005).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockManifestEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Stable registry key, e.g. "ac-hero", "ac-faq-accordion" */
  type: string;
  /** Zod schema. Every field should have `.default(...)` so partial props validate. */
  schema: TSchema;
  /** Pure React component. Root element uses `ac-<type>` class. */
  component: ComponentType<z.infer<TSchema>>;
  /** Short human label shown in editor block picker */
  label: string;
  /** One-line description for editor + AI prompts */
  description: string;
  /** Optional extra AI guidance (Phase 6) */
  aiHints?: string;
  /** Editor grouping — "header" | "content" | "layout" | "cta" | ... */
  category: string;
};

/**
 * The renderer passes its own `registerBlock` function (D-016) — the
 * package never imports the renderer's registry.
 */
export type RegisterBlockFn = (
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Omit<BlockManifestEntry<any>, "type">,
) => void;

/**
 * Block manifest — populated in Task 2.5. Empty in 0.1.0 skeleton so the
 * publish pipeline (Task 2.7) has something to ship, and so the
 * renderer's import of this module won't fail before the first block
 * lands.
 */
export const blockManifest: BlockManifestEntry[] = [];

/**
 * Registers every manifest entry against the caller-supplied register
 * function. Idempotent only if the caller's register is idempotent.
 */
export function registerAll(register: RegisterBlockFn): void {
  for (const entry of blockManifest) {
    const { type, ...rest } = entry;
    register(type, rest);
  }
}
