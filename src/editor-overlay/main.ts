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
import { blockTypeFor, findEditables, type EditableFieldMap } from "./dom.js";
import { createImageOverlay } from "./images.js";
import { createLinkOverlay, type UrlValueMap } from "./links.js";
import { createRichTextEditor } from "./rich-text.js";
import { createTextEditor } from "./text-edit.js";

/**
 * `findEditables` classifies by FieldKind alone (Task 3's schema walk has no
 * "rich-text" kind — the rich-text block's `html` field is a bare
 * `ZodString`, same as any plain-text field), so the plain-text/rich-text
 * split happens here: blockType "rich-text" field "html" goes to Task 6's
 * contenteditable-HTML editor; every other "text" field keeps Task 5's
 * innerText path.
 */
function isRichTextField(el: HTMLElement): boolean {
  return blockTypeFor(el) === "rich-text" && el.getAttribute("data-field") === "html";
}

// Marker Task 4's compiler (preview-overlay.ts) and its test assert on —
// `minifySyntax` must not rename/strip this identifier away.
export const __AC_EDIT_OVERLAY__ = true;

export interface EditBootData {
  token: string;
  siteId: string;
  pageId: string;
  fields: EditableFieldMap;
  /**
   * Task 7 — current values of every url-classified field, keyed by
   * blockId then field name, built server-side from `page.blocks` (see
   * `buildUrlValues` in `src/blocks/editable-fields.ts`). Optional: older
   * fixtures/tests that predate this task omit it, so the link overlay
   * falls back to `{}`.
   */
  urls?: UrlValueMap;
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
  const richTextEditor = createRichTextEditor();
  const imageOverlay = createImageOverlay();
  const linkOverlay = createLinkOverlay();

  const bridge = initBridge(bootData.token, (msg: StudioMsg) => {
    switch (msg.type) {
      case "apply-field":
        editor.applyField(msg.blockId, msg.field, msg.value);
        richTextEditor.applyField(msg.blockId, msg.field, msg.value);
        linkOverlay.applyField(msg.blockId, msg.field, msg.value);
        break;
      case "set-readonly":
        editor.setReadonly(msg.on, msg.reason);
        richTextEditor.setReadonly(msg.on, msg.reason);
        imageOverlay.setReadonly(msg.on);
        linkOverlay.setReadonly(msg.on);
        break;
      case "apply-image":
        imageOverlay.applyImage(msg.blockId, msg.field, msg.src, msg.alt);
        break;
    }
  });

  const editables = findEditables(bootData.fields);
  const richTextEditables = editables.filter(isRichTextField);
  const plainTextEditables = editables.filter((el) => !isRichTextField(el));

  editor.activate(plainTextEditables, bridge, bootData.token);
  richTextEditor.activate(richTextEditables, bridge, bootData.token);
  imageOverlay.activate(document, bootData.fields, bridge, bootData.token);
  linkOverlay.activate(document, bootData.fields, bootData.urls ?? {}, bridge, bootData.token);

  if (bootData.readonly) {
    editor.setReadonly(true);
    richTextEditor.setReadonly(true);
    imageOverlay.setReadonly(true);
    linkOverlay.setReadonly(true);
  }

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
