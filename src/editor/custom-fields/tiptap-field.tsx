import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Field } from "../index.js";

/**
 * Tiptap rich-text editor wrapped as a Puck custom field (P5-T5.6 / D-017).
 *
 * The `rich-text` block stores an HTML string in `props.html` which the prod
 * renderer injects via `dangerouslySetInnerHTML`. Tiptap edits that exact
 * shape: `content: value` in, `editor.getHTML()` out — so the serialized
 * output is precisely what the renderer expects. No new storage shape.
 */
function TiptapField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: "ac-tiptap__content" } },
  });

  // Sync when `value` changes from OUTSIDE the editor (e.g. revision restore).
  // Typing keeps value === getHTML(), so this is a no-op mid-edit.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "");
    }
  }, [editor, value]);

  if (!editor) return null;

  const tools: Array<{ label: string; isActive: boolean; run: () => void }> = [
    { label: "B", isActive: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "I", isActive: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "H2", isActive: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3", isActive: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "• List", isActive: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1. List", isActive: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];

  return (
    <div className="ac-tiptap rounded border border-zinc-200">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 p-1">
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            // preventDefault keeps editor focus/selection while clicking the toolbar
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.run}
            aria-pressed={t.isActive}
            className={`rounded px-2 py-1 text-xs ${t.isActive ? "bg-indigo-100 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Puck custom field that edits an HTML-string prop with Tiptap. */
export function tiptapField(label = "Content"): Field {
  return {
    type: "custom",
    label,
    render: ({ value, onChange }: { value: unknown; onChange: (value: string) => void }) => (
      <TiptapField value={typeof value === "string" ? value : ""} onChange={onChange} />
    ),
  } as Field;
}
