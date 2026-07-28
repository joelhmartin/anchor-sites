/**
 * Contenteditable text-field activation (Inline Editing Task 5).
 *
 * Plain-text fields only (`kind: "text"`) — rich-text is Task 6. One
 * `TextEditor` instance owns the set of activated fields for a single overlay
 * boot; `main.ts` creates exactly one per page load (or per test).
 */

import type { Bridge } from "./bridge.js";
import { blockIdFor } from "./dom.js";

/** Overlay-side debounce before a field-edit is sent. Studio's SAVE debounce (2s) is separate. */
export const FIELD_EDIT_DEBOUNCE_MS = 400;

export const ACTIVE_CLASS = "ac-edit-active";
export const READONLY_CLASS = "ac-edit-readonly";
export const BANNER_CLASS = "ac-edit-readonly-banner";

/**
 * `innerText` reflects rendered text (respects `<br>`/block boundaries,
 * collapses hidden content) the way a contenteditable field's visible value
 * should be read/written — but jsdom (our test environment) doesn't
 * implement it at all (`"innerText" in el` is false there), so both helpers
 * fall back to `textContent`, which is equivalent for the plain single-node
 * text fields this task activates.
 */
function readText(el: HTMLElement): string {
  const innerText = (el as { innerText?: unknown }).innerText;
  return typeof innerText === "string" ? innerText : (el.textContent ?? "");
}

function writeText(el: HTMLElement, value: string): void {
  if (typeof (el as { innerText?: unknown }).innerText === "string") {
    el.innerText = value;
  } else {
    el.textContent = value;
  }
}

interface FieldState {
  el: HTMLElement;
  blockId: string;
  field: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** Placeholder text captured from a `data-empty="true"` field, so a blur-while-empty can restore it. */
  placeholder: string | null;
}

export interface TextEditor {
  /** Wire click/input/blur/keydown handlers on every given field element. */
  activate(els: HTMLElement[], bridge: Bridge, token: string): void;
  /** Inbound `apply-field` (Studio → overlay): set the field's text directly (422-revert path). */
  applyField(blockId: string, field: string, value: string): void;
  /** Inbound `set-readonly`: disable editing on every activated field and toggle the banner. */
  setReadonly(on: boolean, reason?: string): void;
}

export function createTextEditor(): TextEditor {
  const states = new Map<HTMLElement, FieldState>();
  let readonly = false;
  let banner: HTMLElement | null = null;

  function flush(state: FieldState, bridge: Bridge, token: string): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    bridge.send({
      ac: "edit",
      token,
      type: "field-edit",
      blockId: state.blockId,
      field: state.field,
      kind: "text",
      value: readText(state.el),
    });
  }

  function beginEdit(state: FieldState): void {
    if (readonly) return;
    const el = state.el;
    el.contentEditable = "true";
    el.classList.add(ACTIVE_CLASS);
    if (el.hasAttribute("data-empty")) {
      writeText(el, "");
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function endEdit(state: FieldState, bridge: Bridge, token: string): void {
    const el = state.el;
    const hadPending = state.timer !== null;
    if (hadPending) flush(state, bridge, token);

    const text = readText(el);
    if (text.trim() === "" && state.placeholder !== null) {
      writeText(el, state.placeholder);
      el.setAttribute("data-empty", "true");
    } else {
      el.removeAttribute("data-empty");
    }
    el.contentEditable = "false";
    el.classList.remove(ACTIVE_CLASS);
  }

  function showBanner(on: boolean, reason?: string): void {
    if (on) {
      if (!banner) {
        banner = document.createElement("div");
        banner.className = BANNER_CLASS;
        document.body.appendChild(banner);
      }
      banner.textContent = reason ?? "This page is read-only.";
    } else if (banner) {
      banner.remove();
      banner = null;
    }
  }

  return {
    activate(els, bridge, token) {
      for (const el of els) {
        const blockId = blockIdFor(el);
        const field = el.getAttribute("data-field");
        if (!blockId || !field) continue;

        const state: FieldState = {
          el,
          blockId,
          field,
          timer: null,
          placeholder: el.hasAttribute("data-empty") ? readText(el) : null,
        };
        states.set(el, state);

        el.addEventListener("click", () => beginEdit(state));

        el.addEventListener("input", () => {
          if (readonly) return;
          if (state.timer) clearTimeout(state.timer);
          state.timer = setTimeout(() => flush(state, bridge, token), FIELD_EDIT_DEBOUNCE_MS);
        });

        el.addEventListener("blur", () => endEdit(state, bridge, token));

        el.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            el.blur();
          }
        });
      }
    },

    applyField(blockId, field, value) {
      for (const state of states.values()) {
        if (state.blockId !== blockId || state.field !== field) continue;
        writeText(state.el, value);
        if (value === "" && state.placeholder !== null) {
          state.el.setAttribute("data-empty", "true");
        } else {
          state.el.removeAttribute("data-empty");
        }
      }
    },

    setReadonly(on, reason) {
      readonly = on;
      for (const state of states.values()) {
        state.el.contentEditable = "false";
        state.el.classList.remove(ACTIVE_CLASS);
        state.el.classList.toggle(READONLY_CLASS, on);
      }
      showBanner(on, reason);
    },
  };
}
