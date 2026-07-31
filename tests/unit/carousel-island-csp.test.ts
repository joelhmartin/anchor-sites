import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CAROUSEL_ISLAND_JS } from "@anchorcorps/components";
import { CAROUSEL_ISLAND_CSP_HASH } from "../../src/server/csp.js";

/**
 * D1200 — the carousel enhancement island is allowed in preview CSPs by
 * sha256 hash (live pages already allow it via 'unsafe-inline'). The server
 * computes the hash from the package's exported constant at module load, so
 * the two can never drift — this test locks the derivation and the CSP
 * source-expression format the routes interpolate.
 */
describe("CAROUSEL_ISLAND_CSP_HASH (D1200)", () => {
  it("is the base64 sha256 of the exact island source, in CSP source form", () => {
    const expected = createHash("sha256").update(CAROUSEL_ISLAND_JS, "utf8").digest("base64");
    expect(CAROUSEL_ISLAND_CSP_HASH).toBe(`'sha256-${expected}'`);
  });

  it("matches the CSP hash-source grammar", () => {
    expect(CAROUSEL_ISLAND_CSP_HASH).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/);
  });

  it("the global buildCsp (live pages) is untouched — no hash that would disable 'unsafe-inline'", async () => {
    const { buildCsp } = await import("../../src/server/csp.js");
    const scriptSrc = (buildCsp({}).scriptSrc as string[]).join(" ");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("sha256");
  });
});
