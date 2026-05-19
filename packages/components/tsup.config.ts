import { defineConfig } from "tsup";

/**
 * tsup build pipeline for @anchorcorps/components (D-027).
 *
 * Emits ESM + CJS + .d.ts in one invocation. CSS handling is added in
 * Task 2.3 once Tailwind is wired (D-028) — until then, no CSS file is
 * produced. The exports map already advertises `./styles.css`; missing
 * CSS at this stage is acceptable because no consumer imports it yet.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["react", "react-dom", "react/jsx-runtime", "zod"],
  target: "es2022",
});
