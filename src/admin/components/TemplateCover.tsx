import { useEffect, useState } from "react";
import { cn } from "../ui/cn.js";

/**
 * Template cover image with a designed fallback (extracted from NewSitePage
 * for W1.1 so the gallery card AND the template detail dialog share it).
 *
 * D206: the gradient-initials fallback used to trigger only on a NULL cover
 * URL — a cover that 404/403'd rendered the browser's broken-image glyph
 * (the exact failure the media-bucket outage produced across the whole
 * gallery). `onError` now flips to the same fallback branch.
 *
 * D714: the cover carries real alt text (the template's name at minimum)
 * instead of the hardcoded `alt=""` the gallery used to ship.
 */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

/** Deterministic hue from a string so the same template always gets the same
 * placeholder gradient across renders/reloads. */
function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function TemplateCover({
  name,
  coverImageUrl,
  className,
}: {
  name: string;
  coverImageUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // A different template (or a re-seeded cover URL) gets a fresh chance to load.
  useEffect(() => setFailed(false), [coverImageUrl]);

  if (coverImageUrl && !failed) {
    return (
      <img
        src={coverImageUrl}
        alt={`${name} template cover`}
        onError={() => setFailed(true)}
        className={cn(
          "h-40 w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]",
          className,
        )}
      />
    );
  }
  const hue = hashHue(name);
  return (
    <div
      role="img"
      aria-label={`${name} template cover`}
      className={cn(
        "flex h-40 w-full items-center justify-center text-2xl font-semibold text-white transition-transform duration-200 group-hover:scale-[1.04]",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 70% 32%))`,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
