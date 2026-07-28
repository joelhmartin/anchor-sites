/**
 * Rich-text contenteditable field + floating mini toolbar (Inline Editing
 * Task 6).
 *
 * Handles exactly the fields `main.ts` routes here: blockType "rich-text",
 * field "html". Unlike `text-edit.ts`'s plain-text fields (`innerText`/
 * `textContent`), this edits `innerHTML` directly — content is user-authored
 * HTML (paragraphs, headings, lists, links) — and every outbound
 * `field-edit` is run through `sanitizeHtml` first: the overlay is the only
 * thing standing between raw contenteditable output and the wire.
 *
 * The preview iframe is sandboxed (`allow-scripts`, no `allow-modals`), so
 * `window.prompt()` is silently blocked — the Link button can't use it.
 * Instead it opens a small inline input row inside the toolbar itself.
 */

import type { Bridge } from "./bridge.js";
import { blockIdFor } from "./dom.js";
import { sanitizeHtml } from "./sanitize.js";

/** Overlay-side debounce before a field-edit is sent (matches text-edit.ts). */
export const FIELD_EDIT_DEBOUNCE_MS = 400;

export const RT_ACTIVE_CLASS = "ac-edit-rt-active";
export const RT_TOOLBAR_CLASS = "ac-edit-rt-toolbar";
export const RT_TOOLBAR_VISIBLE_CLASS = "ac-edit-rt-toolbar--visible";
export const RT_LINK_ROW_CLASS = "ac-edit-rt-link-row";
export const RT_LINK_ROW_VISIBLE_CLASS = "ac-edit-rt-link-row--visible";
export const RT_BOLD_BTN_CLASS = "ac-edit-rt-btn-bold";
export const RT_ITALIC_BTN_CLASS = "ac-edit-rt-btn-italic";
export const RT_LIST_BTN_CLASS = "ac-edit-rt-btn-list";
export const RT_LINK_BTN_CLASS = "ac-edit-rt-btn-link";
export const RT_LINK_INPUT_CLASS = "ac-edit-rt-link-input";
export const RT_LINK_APPLY_CLASS = "ac-edit-rt-link-apply";

/** Only `http(s)://` links may be created — rejects `javascript:`, `data:`, etc. */
const HTTP_URL = /^https?:\/\//i;

interface FieldState {
  el: HTMLElement;
  blockId: string;
  field: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface RichTextEditor {
  /** Wire click/input/blur/keydown handlers on every given rich-text field element. */
  activate(els: HTMLElement[], bridge: Bridge, token: string): void;
  /** Inbound `apply-field` (Studio → overlay): set the field's sanitized HTML directly (422-revert path). */
  applyField(blockId: string, field: string, value: string): void;
  /** Inbound `set-readonly`: disable editing on every activated field (the shared banner lives in text-edit.ts). */
  setReadonly(on: boolean, reason?: string): void;
  /**
   * Tear down the document-level `selectionchange` listener and remove the
   * toolbar node from the DOM. Not currently called anywhere — `main.ts`'s
   * `boot()` creates exactly one `RichTextEditor` per page load and the
   * overlay lives for the page's lifetime, so there's nothing to tear down
   * in production today. Exposed for hygiene/reuse (e.g. a future SPA-style
   * re-boot without a full page reload, or tighter test cleanup) rather than
   * because anything currently calls it.
   */
  destroy(): void;
}

export function createRichTextEditor(): RichTextEditor {
  const states = new Map<HTMLElement, FieldState>();
  let readonly = false;
  let activeState: FieldState | null = null;
  let currentBridge: Bridge | null = null;
  let currentToken: string | null = null;
  let listening = false;

  let toolbar: HTMLElement | null = null;
  let linkRow: HTMLElement | null = null;
  let linkInput: HTMLInputElement | null = null;

  function makeButton(label: string, cls: string, onActivate: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.textContent = label;
    // preventDefault on mousedown keeps the live selection alive (a plain
    // click on a button outside the contenteditable field would otherwise
    // collapse it before the click handler runs).
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", onActivate);
    return btn;
  }

  function ensureToolbar(): HTMLElement {
    if (toolbar) return toolbar;

    const root = document.createElement("div");
    root.className = RT_TOOLBAR_CLASS;

    root.appendChild(makeButton("B", RT_BOLD_BTN_CLASS, () => runCommand("bold")));
    root.appendChild(makeButton("I", RT_ITALIC_BTN_CLASS, () => runCommand("italic")));
    root.appendChild(makeButton("•", RT_LIST_BTN_CLASS, () => runCommand("insertUnorderedList")));
    root.appendChild(makeButton("Link", RT_LINK_BTN_CLASS, () => toggleLinkRow()));

    const row = document.createElement("div");
    row.className = RT_LINK_ROW_CLASS;

    const input = document.createElement("input");
    input.type = "text";
    input.className = RT_LINK_INPUT_CLASS;
    input.placeholder = "https://…";
    // Buttons steal focus/selection on mousedown too, so guard the same way.
    input.addEventListener("mousedown", (e) => e.stopPropagation());

    const apply = makeButton("Apply", RT_LINK_APPLY_CLASS, () => applyLink());

    row.appendChild(input);
    row.appendChild(apply);
    root.appendChild(row);

    document.body.appendChild(root);
    toolbar = root;
    linkRow = row;
    linkInput = input;
    return root;
  }

  function runCommand(cmd: string): void {
    if (!activeState) return;
    document.execCommand(cmd);
    scheduleFlush(activeState);
  }

  function toggleLinkRow(): void {
    if (!linkRow || !linkInput) return;
    const showing = linkRow.classList.toggle(RT_LINK_ROW_VISIBLE_CLASS);
    if (showing) {
      linkInput.value = "";
      linkInput.focus();
    }
  }

  function applyLink(): void {
    if (!activeState || !linkInput) return;
    const url = linkInput.value.trim();
    if (!HTTP_URL.test(url)) return; // guard: reject javascript:/data:/relative/etc.
    document.execCommand("createLink", false, url);
    linkRow?.classList.remove(RT_LINK_ROW_VISIBLE_CLASS);
    scheduleFlush(activeState);
  }

  function positionToolbar(range: Range): void {
    if (!toolbar) return;
    // jsdom's Range doesn't implement getBoundingClientRect (real browsers
    // do) — positioning is cosmetic, so just skip it rather than throw.
    if (typeof range.getBoundingClientRect !== "function") return;
    const rect = range.getBoundingClientRect();
    toolbar.style.position = "absolute";
    toolbar.style.top = `${window.scrollY + rect.top - toolbar.offsetHeight - 8}px`;
    toolbar.style.left = `${window.scrollX + rect.left}px`;
  }

  function showToolbarFor(state: FieldState, range: Range): void {
    const t = ensureToolbar();
    activeState = state;
    positionToolbar(range);
    t.classList.add(RT_TOOLBAR_VISIBLE_CLASS);
  }

  function hideToolbar(): void {
    toolbar?.classList.remove(RT_TOOLBAR_VISIBLE_CLASS);
    linkRow?.classList.remove(RT_LINK_ROW_VISIBLE_CLASS);
  }

  function findOwningState(el: Element): FieldState | null {
    for (const state of states.values()) {
      if (state.el.contains(el)) return state;
    }
    return null;
  }

  function onSelectionChange(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideToolbar();
      return;
    }
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerEl =
      container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    const state = containerEl ? findOwningState(containerEl) : null;
    if (!state) {
      hideToolbar();
      return;
    }
    showToolbarFor(state, range);
  }

  function flush(state: FieldState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!currentBridge || !currentToken) return;
    currentBridge.send({
      ac: "edit",
      token: currentToken,
      type: "field-edit",
      blockId: state.blockId,
      field: state.field,
      kind: "text",
      value: sanitizeHtml(state.el.innerHTML),
    });
  }

  function scheduleFlush(state: FieldState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => flush(state), FIELD_EDIT_DEBOUNCE_MS);
  }

  return {
    activate(els, bridge, token) {
      currentBridge = bridge;
      currentToken = token;

      for (const el of els) {
        const blockId = blockIdFor(el);
        const field = el.getAttribute("data-field");
        if (!blockId || !field) continue;

        const state: FieldState = { el, blockId, field, timer: null };
        states.set(el, state);

        el.addEventListener("click", () => {
          if (readonly) return;
          el.contentEditable = "true";
          el.classList.add(RT_ACTIVE_CLASS);
          el.focus();
        });

        el.addEventListener("input", () => {
          if (readonly) return;
          scheduleFlush(state);
        });

        el.addEventListener("blur", () => {
          if (state.timer) flush(state);
          el.contentEditable = "false";
          el.classList.remove(RT_ACTIVE_CLASS);
          if (activeState === state) activeState = null;
          hideToolbar();
        });

        el.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            el.blur();
          }
        });
      }

      if (!listening && els.length > 0) {
        document.addEventListener("selectionchange", onSelectionChange);
        listening = true;
      }
    },

    applyField(blockId, field, value) {
      for (const state of states.values()) {
        if (state.blockId !== blockId || state.field !== field) continue;
        state.el.innerHTML = sanitizeHtml(value);
      }
    },

    setReadonly(on) {
      readonly = on;
      for (const state of states.values()) {
        state.el.contentEditable = "false";
        state.el.classList.remove(RT_ACTIVE_CLASS);
      }
      if (on) hideToolbar();
    },

    destroy() {
      if (listening) {
        document.removeEventListener("selectionchange", onSelectionChange);
        listening = false;
      }
      for (const state of states.values()) {
        if (state.timer) clearTimeout(state.timer);
      }
      toolbar?.remove();
      toolbar = null;
      linkRow = null;
      linkInput = null;
      activeState = null;
    },
  };
}
