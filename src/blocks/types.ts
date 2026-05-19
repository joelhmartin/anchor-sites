import type { ComponentType } from "react";
import type { z } from "zod";

/**
 * Canonical block shape (D-001). Stored in `pages.blocks` JSONB.
 * Mutated by the AI editor (Phase 6) and the visual editor (Phase 5 / D-017).
 */
export type Block = {
  /** nanoid — stable across edits, used as React key */
  id: string;
  /** registry key (e.g. "hero", "rich-text", "cta") */
  type: string;
  /** validated against the registry schema at render time */
  props: Record<string, unknown>;
  /** optional nested blocks (containers / sections later) */
  children?: Block[];
};

/**
 * A registry entry describes everything the system needs to know about a
 * block type: how to validate it, how to render it, and how to surface it
 * in the editor + AI prompts.
 *
 * The schema is the contract (D-002). Component is a pure function of props.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockRegistryEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Zod schema. Use `.default(...)` on every field so partial props validate. */
  schema: TSchema;
  /** Pure function of props. Must use `ac-` class prefix on the root element. */
  component: ComponentType<z.infer<TSchema>>;
  /** Short human-readable name shown in the editor's block picker */
  label: string;
  /** One-line description shown in the editor + sent to AI as guidance */
  description: string;
  /** Optional extra context for the AI editor (Phase 6) */
  aiHints?: string;
  /** Editor grouping — "header", "content", "layout", "cta", etc. */
  category: string;
};
