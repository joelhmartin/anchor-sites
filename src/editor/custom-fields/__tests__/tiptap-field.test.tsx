// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Mock Tiptap so we test the field's value<->HTML contract without booting a
// real ProseMirror EditorView in jsdom (fragile; visual QA is operator-run).
let capturedOpts: { content?: string; onUpdate?: (p: { editor: unknown }) => void } | null = null;
const chainProxy: unknown = new Proxy({}, { get: () => () => chainProxy });
const fakeEditor = {
  getHTML: () => "<p>edited</p>",
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
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));

import { tiptapField } from "../tiptap-field.js";

type RenderProps = { value: unknown; onChange: (v: string) => void };
function renderField(value: unknown, onChange: (v: string) => void) {
  const field = tiptapField("Content") as unknown as {
    render: (p: RenderProps) => React.ReactElement;
  };
  return render(<>{field.render({ value, onChange })}</>);
}

describe("tiptapField (P5-T5.6)", () => {
  afterEach(() => {
    cleanup();
    capturedOpts = null;
  });

  it("is a Puck custom field labelled Content", () => {
    const field = tiptapField("Content") as unknown as { type: string; label: string; render: unknown };
    expect(field.type).toBe("custom");
    expect(field.label).toBe("Content");
    expect(typeof field.render).toBe("function");
  });

  it("seeds the editor with the current HTML value", () => {
    renderField("<p>start</p>", () => {});
    expect(capturedOpts?.content).toBe("<p>start</p>");
  });

  it("flows edits back out as an HTML string via onChange (renderer-ready)", () => {
    const onChange = vi.fn();
    renderField("<p>start</p>", onChange);
    capturedOpts?.onUpdate?.({ editor: fakeEditor });
    expect(onChange).toHaveBeenCalledWith("<p>edited</p>");
  });

  it("coerces a non-string value to empty content", () => {
    renderField(undefined, () => {});
    expect(capturedOpts?.content).toBe("");
  });
});
