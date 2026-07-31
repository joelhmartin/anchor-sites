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
 * "🚀", or deliberate short text like "01" / "◆") — `FeatureIcon` renders
 * those verbatim. A word-like string that ISN'T a curated key is treated as
 * a failed icon-name bet and renders a neutral dot glyph instead of the
 * literal word (D1202 — templates authored "book"/"sun"/… and live sites
 * printed the words inside the accent squares).
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

function Book({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function Sun({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function Home({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function Dollar({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function Briefcase({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

/**
 * Neutral fallback for unknown icon NAMES (D1202) — a plain dot, so a
 * misspelled/uncurated name degrades to a quiet bullet instead of printing
 * the word inside the accent square. Deliberately NOT in `CURATED_ICONS`.
 */
function NeutralDot({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
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
  book: Book,
  sun: Sun,
  home: Home,
  dollar: Dollar,
  briefcase: Briefcase,
};

/**
 * A "word-like" value (2+ chars, letters/digits/dashes, starting with a
 * letter) was meant to be an icon name. Anything else — an emoji, "01",
 * "◆", a single decorative letter — is deliberate short text.
 */
const ICON_NAME_RE = /^[a-z][a-z0-9-]+$/i;

/**
 * Renders `icon` as a curated SVG glyph when it matches a known name.
 * Unknown word-like names get the neutral dot glyph (never the literal
 * word); emoji / deliberate short text still render verbatim.
 */
export function FeatureIcon({ icon, className }: { icon: string; className?: string }) {
  const Named = CURATED_ICONS[icon];
  if (Named) return <Named className={className} />;
  if (ICON_NAME_RE.test(icon)) return <NeutralDot className={className} />;
  return (
    <span className={className} aria-hidden="true">
      {icon}
    </span>
  );
}
