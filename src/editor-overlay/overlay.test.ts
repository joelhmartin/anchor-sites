// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type EditBootData } from "./main.js";
import { ACTIVE_CLASS, BANNER_CLASS, READONLY_CLASS } from "./text-edit.js";

/**
 * Overlay core tests (Inline Editing Task 5).
 *
 * Builds a DOM fixture matching BlockRenderer's editable output
 * (`[data-block-id][data-block-type]` wrapper + `[data-field]` children),
 * stubs `window.parent.postMessage`, and boots `main.ts` directly (no
 * esbuild — these import the TS modules as-is).
 */

const TOKEN = "tok_abc123";

const FIELDS: EditBootData["fields"] = {
  hero: { title: "text", eyebrow: "text", cta_url: "url" },
};

function fixture(): void {
  document.body.innerHTML = `
    <div data-block-id="h1" data-block-type="hero">
      <span data-field="title">Welcome to Acme</span>
      <span data-field="eyebrow" data-empty="true">Add eyebrow…</span>
      <a data-field="cta_url" href="#">Learn more</a>
    </div>
  `;
}

function bootWith(overrides: Partial<EditBootData> = {}): { teardown: () => void } {
  window.__AC_EDIT_BOOT__ = {
    token: TOKEN,
    siteId: "site-1",
    pageId: "page-1",
    fields: FIELDS,
    readonly: false,
    ...overrides,
  };
  const teardown = boot();
  return { teardown: teardown ?? (() => {}) };
}

describe("editor overlay core (Inline Editing Task 5)", () => {
  // `window.parent === window` in jsdom (no real frame nesting), so a
  // passthrough spy on the real postMessage would loop the overlay's own
  // outbound messages back into its inbound listener. Replace `window.parent`
  // with an isolated stub instead of spying on the real one.
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let teardown: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture();
    postMessageSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });
  });

  afterEach(() => {
    teardown?.();
    delete (window as { __AC_EDIT_BOOT__?: unknown }).__AC_EDIT_BOOT__;
    vi.useRealTimers();
  });

  it("sends edit-ready on boot", () => {
    ({ teardown } = bootWith());
    expect(postMessageSpy).toHaveBeenCalledWith({ ac: "edit", token: TOKEN, type: "edit-ready" }, "*");
  });

  it("only activates text-kind fields (title), not url-kind (cta_url)", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    const ctaUrl = document.querySelector('[data-field="cta_url"]') as HTMLElement;

    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(title.contentEditable).toBe("true");

    ctaUrl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctaUrl.contentEditable).not.toBe("true");
  });

  it("click activates contenteditable on a text field", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(title.contentEditable).toBe("true");
    expect(title.classList.contains(ACTIVE_CLASS)).toBe(true);
  });

  it("debounces typing 400ms then sends exactly ONE field-edit with blockId/field/value/token", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    postMessageSpy.mockClear();

    title.textContent = "New Title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    // Additional keystrokes within the window should re-debounce, not add sends.
    vi.advanceTimersByTime(200);
    title.textContent = "New Title!";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(399);
    expect(postMessageSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      { ac: "edit", token: TOKEN, type: "field-edit", blockId: "h1", field: "title", kind: "text", value: "New Title!" },
      "*",
    );
  });

  it("Escape ends editing (contenteditable false) and flushes a pending debounce", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    title.textContent = "Escaped Title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    postMessageSpy.mockClear();

    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    title.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(title.contentEditable).toBe("false");
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "field-edit", value: "Escaped Title" }),
      "*",
    );
  });

  it("apply-field with the correct token reverts the field's text", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    title.textContent = "should be overwritten";

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ac: "edit", token: TOKEN, type: "apply-field", blockId: "h1", field: "title", value: "Reverted" },
      }),
    );

    expect(title.textContent).toBe("Reverted");
  });

  it("apply-field with the wrong token is ignored", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;
    title.textContent = "unchanged";

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ac: "edit", token: "wrong-token", type: "apply-field", blockId: "h1", field: "title", value: "Reverted" },
      }),
    );

    expect(title.textContent).toBe("unchanged");
  });

  it("set-readonly disables editing and shows a banner", () => {
    ({ teardown } = bootWith());
    const title = document.querySelector('[data-field="title"]') as HTMLElement;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ac: "edit", token: TOKEN, type: "set-readonly", on: true, reason: "Locked by another editor" },
      }),
    );

    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(title.contentEditable).not.toBe("true");
    expect(title.classList.contains(READONLY_CLASS)).toBe(true);

    const banner = document.querySelector(`.${BANNER_CLASS}`);
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toBe("Locked by another editor");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ac: "edit", token: TOKEN, type: "set-readonly", on: false },
      }),
    );
    expect(document.querySelector(`.${BANNER_CLASS}`)).toBeNull();
  });

  it("empty-placeholder field clears on focus/click and restores on empty blur", () => {
    ({ teardown } = bootWith());
    const eyebrow = document.querySelector('[data-field="eyebrow"]') as HTMLElement;
    expect(eyebrow.getAttribute("data-empty")).toBe("true");

    eyebrow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(eyebrow.textContent).toBe("");

    eyebrow.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(eyebrow.getAttribute("data-empty")).toBe("true");
    expect(eyebrow.textContent).toBe("Add eyebrow…");
  });

  it("boots readonly from bootData.readonly", () => {
    ({ teardown } = bootWith({ readonly: true }));
    expect(document.querySelector(`.${BANNER_CLASS}`)).not.toBeNull();
  });
});
