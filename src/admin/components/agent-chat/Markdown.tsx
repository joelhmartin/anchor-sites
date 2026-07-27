// src/admin/components/agent-chat/Markdown.tsx
//
// Renders a FINALIZED assistant answer as markdown (worklist item 7).
// Deliberately does NOT use rehype-raw / any raw-HTML passthrough — the
// agent's text is model output, and letting it inject arbitrary HTML into
// the admin DOM would be an XSS hole. `react-markdown` without rehype-raw
// only ever produces the fixed set of elements below, so `components` here
// is a closed, safe allowlist. STREAMING/live text never goes through this
// component — it stays plain `whitespace-pre-wrap` text (see ChatTranscript).

import ReactMarkdown, { type Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-zinc-100 p-2 font-mono text-xs text-zinc-800 last:mb-0">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-[1.55] text-zinc-800">
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
