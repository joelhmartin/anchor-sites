import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Editable, EditModeContext } from "../../editable.js";
import type { StatsBandProps } from "./schema.js";

/**
 * Static count -> grid-cols class lookup. Tailwind's JIT scanner only picks
 * up class names it can see literally in source, so a `` `grid-cols-${n}` ``
 * template built at runtime would silently miss the compiled bundle — every
 * value below must appear as a real string literal here.
 */
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
};
const FALLBACK_GRID_COLS = "grid-cols-2 sm:grid-cols-3";

export function StatsBand({ heading, stats }: StatsBandProps) {
  const editMode = React.useContext(EditModeContext);
  const gridClass = GRID_COLS[stats.length] ?? FALLBACK_GRID_COLS;

  return (
    <section className="ac-stats-band py-16 px-6 bg-theme-accent text-theme-on-accent">
      <div className="ac-stats-band__inner max-w-5xl mx-auto">
        {(heading || editMode) && (
          <Editable
            field="heading"
            as="h2"
            className="ac-stats-band__heading text-2xl md:text-3xl text-center mb-10"
            value={heading}
          />
        )}
        <div className={cn("ac-stats-band__stats grid gap-8 text-center", gridClass)}>
          {stats.map((stat, i) => (
            <div key={i} className="ac-stats-band__stat">
              <div className="ac-stats-band__value text-4xl md:text-5xl font-bold leading-none mb-2">
                {stat.value}
              </div>
              <div className="ac-stats-band__label text-sm md:text-base uppercase tracking-wide opacity-85">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
