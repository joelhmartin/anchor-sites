/**
 * Vitest workspace — runs the root renderer suite AND the
 * @anchorcorps/components suite from a single `npm test` invocation.
 *
 * Per-workspace configs control their own environment (root = node, package =
 * jsdom) and their own includes, so they don't cross-pollute. Vitest's CLI
 * shows a unified summary across both.
 */
export default ["./vitest.config.ts", "./packages/components/vitest.config.ts"];
