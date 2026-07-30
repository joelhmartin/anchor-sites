// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Task B5 (2026-07-30 lovable-workspace SDD): BlockBodyEditor is now a TipTap
 * rich-text editor (Puck removed, D-017 retired). Mock `@tiptap/react` the
 * same way `src/editor/custom-fields/__tests__/tiptap-field.test.tsx` did —
 * a real ProseMirror EditorView is fragile in jsdom; visual QA is
 * operator-run. `capturedOpts` lets each test drive `onUpdate` to simulate
 * user typing.
 */
let capturedOpts: { content?: string; onUpdate?: (p: { editor: unknown }) => void } | null = null;
let nextHtml = "<p>hi</p>";
const chainProxy: unknown = new Proxy({}, { get: () => () => chainProxy });
const fakeEditor = {
  getHTML: () => nextHtml,
  isActive: () => false,
  chain: () => chainProxy,
  commands: { setContent: vi.fn() },
};

vi.mock("@tiptap/react", () => ({
  useEditor: (opts: { content?: string; onUpdate?: (p: { editor: unknown }) => void }) => {
    capturedOpts = opts;
    return fakeEditor;
  },
  EditorContent: () => null,
}));
vi.mock("@tiptap/starter-kit", () => ({
  default: { configure: () => ({}) },
}));

import { BlockBodyEditor } from "./BlockBodyEditor.js";
import type { Block } from "../../blocks/types.js";

const RICH_TEXT_BLOCK: Block = {
  id: "b1",
  type: "rich-text",
  props: { html: "<p>hi</p>", max_width: "medium" },
};
const HERO_BLOCK: Block = { id: "h1", type: "hero", props: { title: "Hi" } };

function renderEditor(value: Block[], onPublish = vi.fn()) {
  render(
    <MemoryRouter>
      <BlockBodyEditor slug="acme" value={value} onPublish={onPublish} />
    </MemoryRouter>,
  );
  return onPublish;
}

describe("BlockBodyEditor (Task B5 — Puck removed)", () => {
  afterEach(() => {
    cleanup();
    capturedOpts = null;
    nextHtml = "<p>hi</p>";
  });

  it("seeds the TipTap editor with the single rich-text block's html", () => {
    renderEditor([RICH_TEXT_BLOCK]);
    expect(capturedOpts?.content).toBe("<p>hi</p>");
  });

  it("round-trips a single rich-text block: publish emits [{id, type: rich-text, props}]", () => {
    nextHtml = "<p>edited</p>";
    const onPublish = renderEditor([RICH_TEXT_BLOCK]);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onPublish).toHaveBeenCalledWith([
      { id: "b1", type: "rich-text", props: { html: "<p>edited</p>", max_width: "medium" } },
    ]);
  });

  it("sanitizes the outgoing html (strips a disallowed tag, keeps an https link)", () => {
    nextHtml = '<p>ok</p><script>alert(1)</script><p><a href="https://example.com">go</a></p>';
    const onPublish = renderEditor([RICH_TEXT_BLOCK]);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const [[blocks]] = onPublish.mock.calls;
    expect(blocks[0].props.html).toBe('<p>ok</p><p><a href="https://example.com">go</a></p>');
  });

  it("starts a fresh empty body as an editable rich-text block with a default", () => {
    const onPublish = renderEditor([]);
    expect(capturedOpts?.content).toBe("<p>Edit this text.</p>");
    nextHtml = "<p>first content</p>";
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const [[blocks]] = onPublish.mock.calls;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("rich-text");
    expect(blocks[0].props).toEqual({ html: "<p>first content</p>", max_width: "medium" });
    expect(typeof blocks[0].id).toBe("string");
    expect(blocks[0].id.length).toBeGreaterThan(0);
  });

  it("shows a read-only AI-managed panel for a single non-rich-text block and never mounts TipTap", () => {
    const onPublish = renderEditor([HERO_BLOCK]);
    expect(screen.getByText(/AI-managed/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /workspace/i });
    expect(link.getAttribute("href")).toBe("/sites/acme");
    expect(capturedOpts).toBeNull(); // useEditor never called
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("shows the read-only panel for a mixed multi-block body (rich-text among others) and doesn't destroy it", () => {
    const onPublish = renderEditor([HERO_BLOCK, RICH_TEXT_BLOCK]);
    expect(screen.getByText(/AI-managed/)).toBeTruthy();
    expect(capturedOpts).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(onPublish).not.toHaveBeenCalled();
  });
});
