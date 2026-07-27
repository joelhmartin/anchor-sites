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
      <p className="mb-2 text-sm text-zinc-500">
        Ask me to build, rewrite, or restyle this site — I can make changes directly, and every change is
        revertible.
      </p>
      <div className="flex flex-col gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onPreset(preset)}
            className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-left text-xs text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-700"
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
