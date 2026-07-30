/**
 * Curated icon glyphs for `feature-grid`'s `icon` field (Task C2).
 *
 * Hand-rolled inline SVGs — `packages/components` has zero icon-library
 * usage anywhere (see `src/admin/components/agent-chat/icons.tsx`'s
 * precedent), so this stays consistent rather than introducing
 * `lucide-react` into the package for a handful of glyphs. Every path uses
 * `currentColor` so the glyph inherits whatever text-color class its
 * wrapper sets — no hardcoded palette.
 *
 * The `icon` schema field also accepts any other string (an emoji, e.g.
 * "🚀") — `FeatureIcon` falls back to rendering it verbatim when the name
 * isn't one of the keys below.
 */
import * as React from "react";

type IconProps = { className?: string };

function Bolt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function Shield({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

function Sparkles({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2.5c.24 0 .45.16.52.4l1.1 3.72a3.75 3.75 0 0 0 2.56 2.56l3.72 1.1a.54.54 0 0 1 0 1.04l-3.72 1.1a3.75 3.75 0 0 0-2.56 2.56l-1.1 3.72a.54.54 0 0 1-1.04 0l-1.1-3.72a3.75 3.75 0 0 0-2.56-2.56l-3.72-1.1a.54.54 0 0 1 0-1.04l3.72-1.1a3.75 3.75 0 0 0 2.56-2.56l1.1-3.72c.07-.24.28-.4.52-.4Z" />
    </svg>
  );
}

function Heart({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

function Clock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function Users({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function Award({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="6" />
      <path d="M8.2 13.5 7 22l5-3 5 3-1.2-8.5" />
    </svg>
  );
}

function Target({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

function Check({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Star({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" />
    </svg>
  );
}

/** Curated icon-name -> glyph component map. Keys are the schema's `icon` values. */
export const CURATED_ICONS: Record<string, React.ComponentType<IconProps>> = {
  bolt: Bolt,
  shield: Shield,
  sparkles: Sparkles,
  heart: Heart,
  clock: Clock,
  users: Users,
  award: Award,
  target: Target,
  check: Check,
  star: Star,
};

/**
 * Renders `icon` as a curated SVG glyph when it matches a known name;
 * otherwise renders the raw string (an emoji, or any other short text).
 */
export function FeatureIcon({ icon, className }: { icon: string; className?: string }) {
  const Named = CURATED_ICONS[icon];
  if (Named) return <Named className={className} />;
  return (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  );
}
