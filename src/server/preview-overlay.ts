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
 * Edit overlay CSS (Inline Editing Task 5).
 *
 * Class names here match `text-edit.ts`'s exported constants
 * (`ac-edit-active`, `ac-edit-readonly`, `ac-edit-readonly-banner`) — keep
 * them in sync if either side changes.
 *
 *   - `[data-field]` hover: dashed indigo outline, discoverability only.
 *   - `.ac-edit-active`: solid outline while a field is being edited.
 *   - `.ac-edit-readonly`: dims the hover affordance once Studio has flipped
 *     the page to read-only (e.g. another operator holds the save lock).
 *   - `.ac-edit-readonly-banner`: fixed-top amber banner shown in that state.
 */
export const OVERLAY_CSS = `
[data-field] { outline: 1.5px dashed transparent; outline-offset: 1px; cursor: text; transition: outline-color 120ms ease; }
[data-field]:hover { outline-color: rgba(99, 102, 241, 0.6); }
[data-field].ac-edit-active { outline: 1.5px solid #6366f1; outline-offset: 1px; }
[data-field].ac-edit-readonly { cursor: default; outline-color: transparent !important; }
.ac-edit-readonly-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  background: #f59e0b; color: #1f2937;
  font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 6px 12px; text-align: center;
}
`;
