// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeHtml } from "./sanitize.js";
import {
  createRichTextEditor,
  RT_LINK_INPUT_CLASS,
  RT_TOOLBAR_VISIBLE_CLASS,
} from "./rich-text.js";
import type { Bridge } from "./bridge.js";

/**
 * Rich-text mini toolbar + allowlist sanitizer tests (Inline Editing Task 6).
 *
 * jsdom has no `document.execCommand` at all (throws "not a function"), so
 * every test that exercises toolbar buttons stubs it with a spy and asserts
 * on the *call*, not on any resulting DOM mutation (jsdom's Range/Selection
 * are real, but there's no browser-grade `execCommand` implementation
 * backing them here).
 */

describe("sanitizeHtml", () => {
  it("keeps allowed tags untouched", () => {
    const html = "<p>Hello <b>bold</b> and <i>italic</i> <strong>strong</strong> <em>em</em></p>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps h2/h3 headings, ul/ol/li, and br", () => {
    const html = "<h2>Title</h2><h3>Sub</h3><ul><li>one</li></ul><ol><li>two</li></ol><p>a<br>b</p>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("removes <script> entirely, including its content", () => {
    const out = sanitizeHtml('<p>Hello</p><script>alert("x")</script><p>World</p>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toBe("<p>Hello</p><p>World</p>");
  });

  it("removes <style> and <iframe> entirely", () => {
    const out = sanitizeHtml('<style>body{color:red}</style><p>ok</p><iframe src="evil.html"></iframe>');
    expect(out).toBe("<p>ok</p>");
  });

  it("unwraps disallowed nodes but keeps their text content", () => {
    const out = sanitizeHtml("<div>kept text</div>");
    expect(out).toBe("kept text");
  });

  it("unwraps nested disallowed nodes, preserving allowed descendants", () => {
    const out = sanitizeHtml("<div><span>wrapped</span> <p>paragraph stays</p></div>");
    expect(out).toBe("wrapped <p>paragraph stays</p>");
  });

  it("keeps a with an https:// href", () => {
    const html = '<p><a href="https://example.com">link</a></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps a with an http:// href", () => {
    const html = '<p><a href="http://example.com">link</a></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("strips a javascript: href but keeps the tag and text", () => {
    const out = sanitizeHtml('<p><a href="javascript:alert(1)">click</a></p>');
    expect(out).toBe("<p><a>click</a></p>");
    expect(out).not.toContain("javascript:");
  });

  it("strips a non-http(s) href (e.g. data:, relative, bare #)", () => {
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="/relative">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="#">x</a>')).toBe("<a>x</a>");
  });

  it("strips onclick and other attributes from allowed tags", () => {
    const out = sanitizeHtml('<p onclick="alert(1)" style="color:red" class="x">text</p>');
    expect(out).toBe("<p>text</p>");
  });

  it("strips non-href attributes from <a> even when href is safe", () => {
    const out = sanitizeHtml('<a href="https://example.com" onclick="steal()" target="_blank">link</a>');
    expect(out).toBe('<a href="https://example.com">link</a>');
  });

  it("drops comment nodes", () => {
    expect(sanitizeHtml("<p>a<!-- comment -->b</p>")).toBe("<p>ab</p>");
  });

  it("is idempotent on already-clean output", () => {
    const once = sanitizeHtml('<p>Hi <a href="https://x.com">x</a></p><script>bad()</script>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});

describe("rich-text toolbar + field editing", () => {
  const TOKEN = "tok_rt1";

  function fixture(): HTMLElement {
    document.body.innerHTML = `
      <div data-block-id="rt1" data-block-type="rich-text">
        <div data-field="html">
          <p>Some paragraph text to select.</p>
        </div>
      </div>
    `;
    return document.querySelector('[data-field="html"]') as HTMLElement;
  }

  function selectWithin(el: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  function collapseSelection(): void {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  }

  let sendSpy: ReturnType<typeof vi.fn>;
  let bridge: Bridge;
  let execSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendSpy = vi.fn();
    bridge = { send: sendSpy, destroy: vi.fn() };
    // jsdom has no execCommand at all; stub it so toolbar code can call it.
    execSpy = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execSpy }).execCommand = execSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("shows the toolbar when selection lands inside an activated rich-text field", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    const toolbar = document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`);
    expect(toolbar).not.toBeNull();
  });

  it("hides the toolbar when the selection collapses", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);
    expect(document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`)).not.toBeNull();

    collapseSelection();
    expect(document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`)).toBeNull();
  });

  it("does not show the toolbar for a selection outside any activated field", () => {
    document.body.innerHTML = `<p id="outside">not editable</p>`;
    const editor = createRichTextEditor();
    editor.activate([], bridge, TOKEN);

    const outside = document.getElementById("outside") as HTMLElement;
    selectWithin(outside);

    expect(document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`)).toBeNull();
  });

  it("Bold button calls execCommand('bold')", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    const boldBtn = document.querySelector(".ac-edit-rt-btn-bold") as HTMLButtonElement;
    boldBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    boldBtn.click();

    expect(execSpy).toHaveBeenCalledWith("bold");
  });

  it("Italic button calls execCommand('italic')", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    const italicBtn = document.querySelector(".ac-edit-rt-btn-italic") as HTMLButtonElement;
    italicBtn.click();

    expect(execSpy).toHaveBeenCalledWith("italic");
  });

  it("List button calls execCommand('insertUnorderedList')", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    const listBtn = document.querySelector(".ac-edit-rt-btn-list") as HTMLButtonElement;
    listBtn.click();

    expect(execSpy).toHaveBeenCalledWith("insertUnorderedList");
  });

  it("Link button opens the inline input row instead of window.prompt", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    const linkBtn = document.querySelector(".ac-edit-rt-btn-link") as HTMLButtonElement;
    linkBtn.click();

    const row = document.querySelector(".ac-edit-rt-link-row");
    expect(row?.classList.contains("ac-edit-rt-link-row--visible")).toBe(true);
    const input = document.querySelector(`.${RT_LINK_INPUT_CLASS}`);
    expect(input).not.toBeNull();
  });

  it("applying a valid https:// link calls execCommand('createLink', false, url)", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    (document.querySelector(".ac-edit-rt-btn-link") as HTMLButtonElement).click();
    const input = document.querySelector(`.${RT_LINK_INPUT_CLASS}`) as HTMLInputElement;
    input.value = "https://example.com";
    (document.querySelector(".ac-edit-rt-link-apply") as HTMLButtonElement).click();

    expect(execSpy).toHaveBeenCalledWith("createLink", false, "https://example.com");
  });

  it("javascript: link guard rejects the URL — execCommand('createLink', ...) is never called", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);

    (document.querySelector(".ac-edit-rt-btn-link") as HTMLButtonElement).click();
    const input = document.querySelector(`.${RT_LINK_INPUT_CLASS}`) as HTMLInputElement;
    input.value = "javascript:alert(1)";
    (document.querySelector(".ac-edit-rt-link-apply") as HTMLButtonElement).click();

    expect(execSpy).not.toHaveBeenCalledWith("createLink", expect.anything(), expect.anything());
  });

  it("debounces innerHTML edits 400ms then sends ONE sanitized field-edit", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    el.innerHTML = '<p>Hello <script>alert(1)</script>world</p>';
    el.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(399);
    expect(sendSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({
      ac: "edit",
      token: TOKEN,
      type: "field-edit",
      blockId: "rt1",
      field: "html",
      kind: "text",
      value: "<p>Hello world</p>",
    });
  });

  it("applyField sets sanitized innerHTML directly (422-revert path)", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);

    editor.applyField("rt1", "html", '<p>Reverted</p><script>bad()</script>');

    expect(el.innerHTML).toBe("<p>Reverted</p>");
  });

  it("setReadonly disables contentEditable and hides the toolbar", () => {
    const el = fixture();
    const editor = createRichTextEditor();
    editor.activate([el], bridge, TOKEN);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    selectWithin(el);
    expect(document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`)).not.toBeNull();

    editor.setReadonly(true);

    expect(el.contentEditable).toBe("false");
    expect(document.querySelector(`.${RT_TOOLBAR_VISIBLE_CLASS}`)).toBeNull();

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el.contentEditable).toBe("false");
  });
});
