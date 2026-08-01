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
 * Edit overlay CSS (Inline Editing Task 5, extended by the final review's
 * Important 2).
 *
 * Class names here match the overlay modules' exported constants — keep
 * them in sync if any side changes:
 *   - `text-edit.ts`: `ac-edit-active`, `ac-edit-readonly`,
 *     `ac-edit-readonly-banner`.
 *   - `images.ts` (`IMAGE_CHIP_CLASS`/`IMAGE_CHIP_VISIBLE_CLASS`):
 *     `ac-edit-image-chip`, `ac-edit-image-chip--visible`.
 *   - `links.ts` (`LINK_CHIP_CLASS`/`LINK_CHIP_VISIBLE_CLASS`):
 *     `ac-edit-link-chip`, `ac-edit-link-chip--visible`.
 *   - `rich-text.ts`: `ac-edit-rt-toolbar`(`--visible`),
 *     `ac-edit-rt-link-row`(`--visible`), and its button/input classes.
 *
 *   - `[data-field]` hover: dashed zinc outline, discoverability only (D331 —
 *     the shell is black/zinc; the overlay accent follows it, not indigo).
 *   - `.ac-edit-active`: solid outline while a field is being edited.
 *   - `.ac-edit-readonly`: dims the hover affordance once Studio has flipped
 *     the page to read-only (e.g. another operator holds the save lock).
 *   - `.ac-edit-readonly-banner`: fixed-top amber banner shown in that state.
 *   - `.ac-edit-image-chip` / `.ac-edit-link-chip`: small pill buttons the
 *     JS positions with inline `style.top`/`style.right` (`absolute`,
 *     relative to a wrapper the JS also flips to `position: relative`) —
 *     this CSS supplies the VISUAL styling (zinc-900 pill, white text) and
 *     the show/hide toggle only; it must not set `position`/`top`/`left`/
 *     `right` itself or it would fight those inline styles. Hidden by
 *     default (opacity + pointer-events, not `display:none`, so the
 *     hover-driven `--visible` toggle stays a cheap paint, not a layout
 *     change) and revealed via the `--visible` modifier class the JS
 *     toggles on mouseenter/mouseleave.
 *   - `.ac-edit-rt-toolbar`: the rich-text mini toolbar. The JS sets
 *     `position: absolute` + `top`/`left` inline (`positionToolbar`,
 *     relative to the current text selection) — same division of labor as
 *     the chips: CSS is visuals + the `--visible` toggle only. It's a
 *     single global toolbar element (not per-field), appended once to
 *     `document.body`.
 *   - `.ac-edit-rt-link-row`: the toolbar's inline URL-input row, opened by
 *     its Link button; hidden by default, shown via `--visible`.
 */
export const OVERLAY_CSS = `
[data-field] { outline: 1.5px dashed transparent; outline-offset: 1px; cursor: text; transition: outline-color 120ms ease; }
[data-field]:hover { outline-color: rgba(24, 24, 27, 0.5); }
[data-field].ac-edit-active { outline: 1.5px solid #18181b; outline-offset: 1px; }
[data-field].ac-edit-readonly { cursor: default; outline-color: transparent !important; }
.ac-edit-readonly-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  background: #f59e0b; color: #1f2937;
  font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 6px 12px; text-align: center;
}

.ac-edit-image-chip, .ac-edit-link-chip {
  z-index: 2147483000;
  border: none; border-radius: 999px; cursor: pointer;
  background: #18181b; color: #fff;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 5px 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  opacity: 0; pointer-events: none;
  transition: opacity 120ms ease;
}
.ac-edit-image-chip--visible, .ac-edit-link-chip--visible {
  opacity: 1; pointer-events: auto;
}
.ac-edit-image-chip:hover, .ac-edit-link-chip:hover { background: #3f3f46; }

.ac-edit-rt-toolbar {
  z-index: 2147483000;
  display: flex; align-items: center; gap: 2px;
  background: #fff; color: #1f2937;
  border: 1px solid #e4e4e7; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  opacity: 0; pointer-events: none;
  transition: opacity 100ms ease;
}
.ac-edit-rt-toolbar--visible { opacity: 1; pointer-events: auto; }

.ac-edit-rt-toolbar button {
  border: none; background: transparent; color: #1f2937;
  border-radius: 4px; cursor: pointer; min-width: 24px; height: 24px;
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.ac-edit-rt-toolbar button:hover { background: #f4f4f5; }

.ac-edit-rt-link-row {
  display: none; align-items: center; gap: 4px;
  margin-left: 4px; padding-left: 4px; border-left: 1px solid #e4e4e7;
}
.ac-edit-rt-link-row--visible { display: flex; }
.ac-edit-rt-link-input {
  font: 400 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  border: 1px solid #d4d4d8; border-radius: 4px; padding: 4px 6px;
  width: 160px; color: #1f2937;
}
.ac-edit-rt-link-apply {
  background: #18181b !important; color: #fff !important;
  padding: 0 8px !important; width: auto !important;
}
.ac-edit-rt-link-apply:hover { background: #3f3f46 !important; }
`;
