import { buildSync } from "esbuild";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(__dirname, "..", "editor-overlay", "main.ts");

let cached: string | null = null;

/**
 * Compile the vanilla-JS edit overlay to a single inlinable IIFE. esbuild is a
 * direct dependency (the runtime executes TS via tsx, so there is no build-time
 * artifact to read); compilation runs once per process and is ~10ms.
 * Inline-with-nonce is REQUIRED: the preview iframe is sandboxed (opaque
 * origin), where CSP 'self' matches nothing — an external script URL cannot work.
 */
export function getOverlayJs(): string {
  if (cached) return cached;
  let result;
  try {
    result = buildSync({
      entryPoints: [ENTRY],
      bundle: true,
      write: false,
      format: "iife",
      target: "es2020",
      // Full `minify: true` renames top-level identifiers away, which would
      // strip the literal "__AC_EDIT_OVERLAY__" boot marker from the output.
      // Keep syntax/whitespace minification but preserve identifier names.
      minifyWhitespace: true,
      minifySyntax: true,
    });
  } catch (err) {
    throw new Error(
      `Failed to compile editor overlay bundle: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!result.outputFiles?.[0]) throw new Error("editor overlay compilation produced no output");
  cached = result.outputFiles[0].text;
  return cached;
}

export function __resetOverlayCacheForTests(): void {
  cached = null;
}

export function makeNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Placeholder overlay CSS (Task 4) — hover-outline only, so an editable field
 * is visibly discoverable in the preview iframe before the real interaction
 * styles land. Task 5 (I5) replaces this with the full `OVERLAY_CSS` (empty
 * placeholders, selection state, drag affordances, etc.) — keep this minimal
 * on purpose so that follow-up diff stays clean.
 */
export const OVERLAY_CSS = `
[data-field] { outline: 1px dashed transparent; outline-offset: 1px; cursor: text; }
[data-field]:hover { outline-color: rgba(99, 102, 241, 0.6); }
`;
