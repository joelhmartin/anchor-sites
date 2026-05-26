import { configDefaults, defineWorkspace } from "vitest/config";

/**
 * Vitest workspace (P7.5-T7.5.0 — test-isolation hardening).
 *
 * The root renderer suite is split into TWO projects so node and jsdom tests
 * never share a worker process. Previously a single `singleFork` node project
 * ran both server/integration files (node) AND the 14 React/UI files that flip
 * to jsdom via the `@vitest-environment jsdom` pragma — mixing two global
 * environments in one fork is the root cause of the FLAKE-RESOLVESITE class
 * (cross-file global-state leak made a fresh app's pre-middleware `/healthz`
 * intermittently 403 under a warm-cache file order). Separate projects get
 * separate pools, so the leak can't cross.
 *
 *   - `node`  : server, integration, smoke, and pure-logic unit tests.
 *               `singleFork` keeps shared test-DB access serialized (the
 *               reason singleFork was chosen originally).
 *   - `jsdom` : React component / Studio UI tests (`src/admin/**` + the editor
 *               component tests). Its own fork, isolated from the node project.
 *
 * The `@anchorcorps/components` package keeps its own jsdom project (third
 * entry), unchanged.
 */

const JSDOM_FILES = [
  "src/admin/**/*.test.{ts,tsx}",
  "src/editor/__tests__/editor-smoke.test.tsx",
  "src/editor/custom-fields/**/*.test.{ts,tsx}",
];

const shared = {
  globals: true,
  css: false,
  testTimeout: 10_000,
  // Hygiene so a leaked spy / stubbed global / stubbed env can't ride between
  // files within a project (defense in depth alongside the node/jsdom split).
  restoreMocks: true,
  unstubGlobals: true,
  unstubEnvs: true,
  pool: "forks" as const,
  poolOptions: { forks: { singleFork: true } },
};

export default defineWorkspace([
  {
    test: {
      ...shared,
      name: "node",
      environment: "node",
      include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
      exclude: [...configDefaults.exclude, ...JSDOM_FILES],
    },
  },
  {
    test: {
      ...shared,
      name: "jsdom",
      environment: "jsdom",
      include: JSDOM_FILES,
    },
  },
  "./packages/components/vitest.config.ts",
]);
