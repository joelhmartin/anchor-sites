import * as React from "react";
import { cn } from "../lib/cn.js";
import { CAROUSEL_ISLAND_JS } from "./carousel-island.js";

/**
 * JS-free-first carousel (D1200 — spec:
 * docs/superpowers/specs/2026-07-31-published-page-interactivity.md).
 *
 * Published tenant pages ship zero client JavaScript (renderToString, no
 * hydration) and preview iframes run under a hash-restricted CSP, so the
 * carousel's BASE behavior must be native: the viewport is a CSS scroll-snap
 * strip — swipe (touch), trackpad scroll, scrollbar drag, and arrow-key
 * scrolling (the viewport is focusable) all work with no script at all.
 *
 * The three behaviors CSS cannot express — arrow buttons, loop wrap-around,
 * autoplay — come from a tiny inline vanilla-JS island (CAROUSEL_ISLAND_JS)
 * each Carousel embeds in its own SSR output. Arrows are CSS-hidden until
 * the island marks the root `data-ac-ready`, so a script-blocked context
 * degrades to a clean swipeable strip — never dead controls (the Embla-era
 * bug this replaces: permanently `disabled` SSR'd arrows).
 *
 * No Embla, no React state, no context: every subcomponent is a pure
 * server-renderable element; the island finds them via `data-ac-*` hooks.
 */

export type CarouselProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Wrap from last slide back to first (arrows + autoplay). */
  loop?: boolean;
  /** Auto-advance interval in ms; omit (or 0) for no autoplay. */
  autoplayMs?: number;
};

export function Carousel({ loop, autoplayMs, className, children, ...props }: CarouselProps) {
  return (
    <div
      role="region"
      aria-roledescription="carousel"
      data-ac-carousel=""
      data-loop={loop ? "" : undefined}
      data-autoplay={autoplayMs && autoplayMs > 0 ? String(autoplayMs) : undefined}
      className={cn("ac-carousel relative", className)}
      {...props}
    >
      {children}
      {/* Inline enhancement island. Placed after the carousel's own content
          so it can initialize immediately — no DOMContentLoaded dependency.
          Idempotent across multiple carousel blocks on one page. Allowed by
          'unsafe-inline' on live pages and by sha256 hash in preview CSPs. */}
      <script dangerouslySetInnerHTML={{ __html: CAROUSEL_ISLAND_JS }} />
    </div>
  );
}

export type CarouselContentProps = React.HTMLAttributes<HTMLDivElement>;

export function CarouselContent({ className, children, ...props }: CarouselContentProps) {
  return (
    <div
      data-ac-viewport=""
      // Focusable so keyboard users can arrow-scroll the snap container
      // natively — no JS key handling required.
      tabIndex={0}
      className={cn(
        "ac-carousel__viewport flex overflow-x-auto snap-x snap-mandatory scroll-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CarouselItemProps = React.HTMLAttributes<HTMLDivElement>;

export function CarouselItem({ className, children, ...props }: CarouselItemProps) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      className={cn("ac-carousel__slide min-w-0 shrink-0 grow-0 basis-full snap-start", className)}
      {...props}
    >
      {children}
    </div>
  );
}

type ArrowButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-label" | "disabled"
> & {
  label?: string;
};

const arrowClass =
  "ac-carousel__arrow absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-10 w-10 rounded-full border border-theme-border bg-theme-surface text-theme-on-surface shadow-sm disabled:opacity-40 disabled:pointer-events-none";

export function CarouselPrevious({ className, label = "Previous slide", children, ...props }: ArrowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-ac-prev=""
      className={cn(arrowClass, "left-2", className)}
      {...props}
    >
      {children ?? <span aria-hidden="true">‹</span>}
    </button>
  );
}

export function CarouselNext({ className, label = "Next slide", children, ...props }: ArrowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-ac-next=""
      className={cn(arrowClass, "right-2", className)}
      {...props}
    >
      {children ?? <span aria-hidden="true">›</span>}
    </button>
  );
}

export { CAROUSEL_ISLAND_JS } from "./carousel-island.js";
