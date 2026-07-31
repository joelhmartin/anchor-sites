import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

/**
 * D806 — the root index.html is the Studio SPA shell that Vite builds into
 * `dist/index.html` and `src/server/index.ts` serves for EVERY admin-host
 * request in prod. Its metadata is the first thing a first-time teammate
 * sees (the login tab), so it must carry the real product identity — not
 * the scaffold's "Site Template" + lorem-ipsum placeholders that were live
 * in prod (verified in the audit's prod response body).
 */
describe("Studio SPA shell metadata (D806/D914)", () => {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

  it("carries the real product title, not the scaffold placeholder", () => {
    expect(html).toContain("<title>AnchorCorps Studio</title>");
    expect(html).not.toContain("Site Template");
  });

  it("has a real meta description (no lorem ipsum anywhere in the shell)", () => {
    expect(html.toLowerCase()).not.toContain("lorem ipsum");
    const m = html.match(/<meta name="description" content="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/AnchorCorps/);
  });

  it("is marked noindex — the admin app is not a public page", () => {
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
  });

  it("links a favicon so the tab shows an icon (D914, studio side)", () => {
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/favicon\.svg"/);
    // The asset must exist in public/ so Vite copies it into dist/.
    expect(() => readFileSync(path.join(ROOT, "public", "favicon.svg"), "utf8")).not.toThrow();
  });
});
