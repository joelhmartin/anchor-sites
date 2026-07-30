import { useState } from "react";
import { nanoid } from "nanoid";
import { Link } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import type { Block } from "../../blocks/types.js";
import { sanitizeHtml } from "../../editor-overlay/sanitize.js";

/**
 * Reusable Block[] body editor (Task B5, 2026-07-30 lovable-workspace SDD).
 *
 * Puck is gone (D-017 retired) — page layout editing moved to chat + inline
 * editing in the workspace (`/sites/:slug`). Posts and events still need a
 * body editor, but a much simpler one: a single `rich-text` block edited as
 * plain HTML with TipTap. The extension set here is deliberately capped to
 * exactly what `src/editor-overlay/sanitize.ts`'s ALLOWED_TAGS allows (P, B/
 * STRONG, I/EM, A, UL/OL/LI, BR, H2/H3) — the same allowlist the inline
 * rich-text overlay enforces — and every outgoing save is run through that
 * SAME `sanitizeHtml` before it reaches the wire, since (per that module's
 * docblock) there is still no server-side HTML sanitizer in this codebase.
 *
 * A post/event body can only be ONE OF:
 *   - empty (`[]`) or a single `rich-text` block  -> editable here.
 *   - anything else (AI-managed multi-block layouts built via the workspace's
 *     Ask AI / chat) -> read-only: rendering this in a plain-text editor and
 *     saving would silently destroy every non-rich-text block, so instead we
 *     show a link out to the workspace and never call `onPublish`.
 */

const DEFAULT_HTML = "<p>Edit this text.</p>";
const DEFAULT_MAX_WIDTH = "medium";

function isSingleRichText(value: Block[]): value is [Block] {
  return value.length === 1 && value[0].type === "rich-text";
}

export function BlockBodyEditor({
  slug,
  value,
  onPublish,
}: {
  /** Site slug — used to link out to the workspace in the AI-managed state. */
  slug: string;
  value: Block[];
  onPublish: (blocks: Block[]) => void;
}) {
  if (value.length > 0 && !isSingleRichText(value)) {
    return <AiManagedPanel slug={slug} />;
  }
  return <RichTextBody value={value} onPublish={onPublish} />;
}

function AiManagedPanel({ slug }: { slug: string }) {
  return (
    <div
      className="flex flex-col items-start gap-2 rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600"
      role="note"
    >
      <p>This layout is AI-managed — edit it in the workspace.</p>
      <Link to={`/sites/${slug}`} className="font-medium text-indigo-600 hover:text-indigo-700">
        Open the workspace →
      </Link>
    </div>
  );
}

const HTTP_URL = /^https?:/i;

function RichTextBody({
  value,
  onPublish,
}: {
  value: Block[];
  onPublish: (blocks: Block[]) => void;
}) {
  const existing = isSingleRichText(value) ? value[0] : null;
  const [blockId] = useState(() => existing?.id ?? nanoid());
  const maxWidth =
    (typeof existing?.props.max_width === "string" ? existing.props.max_width : null) ??
    DEFAULT_MAX_WIDTH;
  const initialHtml =
    (typeof existing?.props.html === "string" ? existing.props.html : null) ?? DEFAULT_HTML;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Disable everything StarterKit ships that isn't on the sanitizer's
        // ALLOWED_TAGS list — keep the editor's real capabilities matching
        // exactly what survives sanitizeHtml (and what the renderer/AI
        // catalog expect from a rich-text block).
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: { openOnClick: false },
      }),
    ],
    content: initialHtml,
    editorProps: { attributes: { class: "ac-tiptap__content" } },
  });

  function publish() {
    if (!editor) return;
    const html = sanitizeHtml(editor.getHTML());
    onPublish([{ id: blockId, type: "rich-text", props: { html, max_width: maxWidth } }]);
  }

  function setLink() {
    if (!editor) return;
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    // eslint-disable-next-line no-alert -- editor page, not a sandboxed preview iframe.
    const url = window.prompt("Link URL (https://…)", previous || "https://");
    if (url === null) return; // cancelled
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!HTTP_URL.test(trimmed)) return; // reject javascript:/data:/relative/etc.
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  }

  if (!editor) return null;

  return (
    <div className="ac-tiptap rounded border border-zinc-200">
      <Toolbar editor={editor} onSetLink={setLink} />
      <EditorContent editor={editor} />
      <div className="flex justify-end border-t border-zinc-200 p-2">
        <button
          type="button"
          onClick={publish}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Publish
        </button>
      </div>
    </div>
  );
}

function Toolbar({ editor, onSetLink }: { editor: Editor; onSetLink: () => void }) {
  const tools: Array<{ label: string; isActive: boolean; run: () => void }> = [
    { label: "B", isActive: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "I", isActive: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "H2", isActive: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3", isActive: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "• List", isActive: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1. List", isActive: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Link", isActive: editor.isActive("link"), run: onSetLink },
  ];

  return (
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
  );
}
