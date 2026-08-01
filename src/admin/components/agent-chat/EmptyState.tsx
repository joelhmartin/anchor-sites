// src/admin/components/agent-chat/EmptyState.tsx
//
// Shown when a conversation has no items yet — a short prompt plus preset
// chips that kick off a send() (worklist item 9).

const PRESETS = [
  "Add a services page",
  "Rewrite the homepage hero to be more compelling",
  "Find and place stock photos on every page",
];

export function EmptyState({ onPreset }: { onPreset: (text: string) => void }) {
  return (
    <div className="px-1 pb-2">
      {/* D307 — the old copy promised "every change is revertible", which is
          false: only page edits carry a revision to restore (page_updated).
          Brand/SEO settings, template applies, image imports and new pages
          have no revert. Say what's actually true instead. */}
      <p className="mb-2 text-sm text-zinc-500">
        Ask me to build, rewrite, or restyle this site — I make changes directly, and page edits can be
        reverted from their change card.
      </p>
      <div className="flex flex-col gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onPreset(preset)}
            className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-left text-xs text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            {preset}
          </button>
        ))}
      </div>
      {/* D325 — direct manipulation is the product's second pillar but was
          only discoverable as a small tertiary "Edit" button on the preview.
          Point at it so a first-run user knows it exists. */}
      <p className="mt-3 text-xs text-zinc-400">
        Prefer to tweak it yourself? Click <span className="font-medium text-zinc-500">Edit</span> on the
        preview to change text and images in place.
      </p>
    </div>
  );
}
