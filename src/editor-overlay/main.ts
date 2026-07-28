/**
 * Edit overlay entry point (Inline Editing Task 5).
 *
 * Bundled standalone (esbuild, IIFE — see src/server/preview-overlay.ts) and
 * inlined into the preview HTML's `<head>` as a nonce-scoped `<script>`. It
 * runs BEFORE the body markup exists (inline scripts in `<head>` execute
 * during parsing), so boot is deferred to `DOMContentLoaded` when the
 * document is still loading; `boot()` itself is exported for direct
 * invocation (tests set up the DOM fixture + `window.__AC_EDIT_BOOT__`, then
 * call `boot()` explicitly instead of relying on that event).
 *
 * Vanilla TS only — no React, no imports from src/admin or src/server.
 */

import { initBridge, type StudioMsg } from "./bridge.js";
import { findEditables, type EditableFieldMap } from "./dom.js";
import { createTextEditor } from "./text-edit.js";

// Marker Task 4's compiler (preview-overlay.ts) and its test assert on —
// `minifySyntax` must not rename/strip this identifier away.
export const __AC_EDIT_OVERLAY__ = true;

export interface EditBootData {
  token: string;
  siteId: string;
  pageId: string;
  fields: EditableFieldMap;
  readonly: boolean;
}

declare global {
  interface Window {
    __AC_EDIT_BOOT__?: EditBootData;
  }
}

/**
 * Read `window.__AC_EDIT_BOOT__`, wire the bridge, activate every classified
 * text field, and announce `edit-ready`. No-ops if the boot payload is
 * absent (e.g. this bundle loaded outside an edit-mode preview). Returns a
 * teardown function tests can use for hygiene between cases; unused in prod
 * (the bridge lives for the page's lifetime).
 */
export function boot(): (() => void) | undefined {
  const bootData = window.__AC_EDIT_BOOT__;
  if (!bootData) return undefined;

  const editor = createTextEditor();

  const bridge = initBridge(bootData.token, (msg: StudioMsg) => {
    switch (msg.type) {
      case "apply-field":
        editor.applyField(msg.blockId, msg.field, msg.value);
        break;
      case "set-readonly":
        editor.setReadonly(msg.on, msg.reason);
        break;
      case "apply-image":
        // Image editing lands in a later task; no-op for now.
        break;
    }
  });

  const editables = findEditables(bootData.fields);
  editor.activate(editables, bridge, bootData.token);

  if (bootData.readonly) editor.setReadonly(true);

  bridge.send({ ac: "edit", token: bootData.token, type: "edit-ready" });

  return () => bridge.destroy();
}

function autoBoot(): void {
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot());
  } else {
    boot();
  }
}

autoBoot();
