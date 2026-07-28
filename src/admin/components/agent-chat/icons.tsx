// src/admin/components/agent-chat/icons.tsx
//
// A single inline sparkle SVG for the assistant's text gutter (worklist item
// 10). `lucide-react` is a repo dependency, but this admin bundle otherwise
// avoids icon-library imports for small one-off marks (`ui/spinner.tsx`'s
// precedent is CSS-over-SVG, not this exact case — but the underlying
// rationale is the same: not worth pulling in a dep for one glyph).
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2.5c.24 0 .45.16.52.4l1.1 3.72a3.75 3.75 0 0 0 2.56 2.56l3.72 1.1a.54.54 0 0 1 0 1.04l-3.72 1.1a3.75 3.75 0 0 0-2.56 2.56l-1.1 3.72a.54.54 0 0 1-1.04 0l-1.1-3.72a3.75 3.75 0 0 0-2.56-2.56l-3.72-1.1a.54.54 0 0 1 0-1.04l3.72-1.1a3.75 3.75 0 0 0 2.56-2.56l1.1-3.72c.07-.24.28-.4.52-.4Z" />
    </svg>
  );
}
