import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Build-output contract. This test runs AFTER `npm run build` and
 * asserts the package emits the artifacts its `exports` map advertises.
 *
 * The test is skipped if `dist/` is missing so developers can run the
 * vitest suite without a fresh build during iteration.
 */
const distDir = join(__dirname, "..", "dist");
const skipIfNoDist = existsSync(distDir) ? describe : describe.skip;

skipIfNoDist("dist/ build artifacts", () => {
  it("emits ESM, CJS, and types entrypoints", () => {
    expect(existsSync(join(distDir, "index.js"))).toBe(true);
    expect(existsSync(join(distDir, "index.cjs"))).toBe(true);
    expect(existsSync(join(distDir, "index.d.ts"))).toBe(true);
  });

  it("emits a non-empty dist/styles.css", () => {
    const cssPath = join(distDir, "styles.css");
    expect(existsSync(cssPath)).toBe(true);
    const size = statSync(cssPath).size;
    // Tailwind base + reset + minimal utilities should easily exceed 1KB.
    expect(size).toBeGreaterThan(1024);
    const content = readFileSync(cssPath, "utf8");
    // Stable signals that the Tailwind pipeline ran:
    //  - the preserved license banner (minify keeps `/*! …*/` comments)
    //  - preflight border-box reset on the universal selector
    expect(content).toMatch(/tailwindcss v\d/);
    expect(content).toMatch(/box-sizing:\s*border-box/);
  });
});
