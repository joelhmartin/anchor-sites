import { cn } from "./cn.js";

/** CSS-only spinner — no inline SVG, no icon dep. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600",
        className,
      )}
    />
  );
}
