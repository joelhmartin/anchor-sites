/**
 * Curated social-platform glyphs for `rich-footer`'s `social_links` items
 * (Task C2). Hand-rolled inline SVGs, `currentColor`-only — same rationale
 * as `feature-grid/icons.tsx`: the package has no icon-library dependency.
 */
import * as React from "react";
import type { SocialLink } from "./schema.js";

type IconProps = { className?: string };

function Facebook({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M14 13.5h2.5l.5-3H14V8.5c0-.86.29-1.5 1.5-1.5H17V4.14C16.63 4.1 15.79 4 14.81 4 12.7 4 11 5.24 11 7.77V10.5H8.5v3H11V21h3v-7.5Z" />
    </svg>
  );
}

function Instagram({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Twitter({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20 6.6c-.6.3-1.3.5-2 .6.7-.4 1.3-1.1 1.5-2-.7.4-1.5.7-2.3.9A3.6 3.6 0 0 0 11 9c0 .3 0 .5.1.8A10.2 10.2 0 0 1 3.6 6a3.6 3.6 0 0 0 1.1 4.8c-.6 0-1.1-.2-1.6-.4v.1c0 1.8 1.3 3.2 2.9 3.6-.5.1-1 .2-1.6.1.5 1.4 1.8 2.5 3.4 2.5A7.3 7.3 0 0 1 2.8 18a10.3 10.3 0 0 0 5.6 1.6c6.7 0 10.4-5.6 10.4-10.4v-.5c.7-.5 1.3-1.2 1.8-1.9Z" />
    </svg>
  );
}

function LinkedIn({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6.94 8.5H4.06V20h2.88V8.5ZM5.5 4a1.67 1.67 0 1 0 0 3.34A1.67 1.67 0 0 0 5.5 4ZM20 13.6c0-3-1.6-4.4-3.8-4.4a3.3 3.3 0 0 0-3 1.6V8.5H10.4V20h2.9v-5.9c0-1.6.9-2.6 2.2-2.6 1.2 0 1.9.8 1.9 2.5V20H20v-6.4Z" />
    </svg>
  );
}

function YouTube({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.6 7.8a2.7 2.7 0 0 0-1.9-1.9C18 5.5 12 5.5 12 5.5s-6 0-7.7.4A2.7 2.7 0 0 0 2.4 7.8 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.2 2.7 2.7 0 0 0 1.9 1.9C6 18.5 12 18.5 12 18.5s6 0 7.7-.4a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.2ZM10 15V9l5.2 3-5.2 3Z" />
    </svg>
  );
}

function TikTok({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 3c.3 1.9 1.5 3.3 3.5 3.5v2.8c-1.3 0-2.5-.4-3.5-1.1v6.1a5.3 5.3 0 1 1-5.3-5.3c.2 0 .4 0 .6.03v2.9a2.4 2.4 0 1 0 1.7 2.3V3h3Z" />
    </svg>
  );
}

const ICONS: Record<SocialLink["platform"], React.ComponentType<IconProps>> = {
  facebook: Facebook,
  instagram: Instagram,
  twitter: Twitter,
  linkedin: LinkedIn,
  youtube: YouTube,
  tiktok: TikTok,
};

const LABELS: Record<SocialLink["platform"], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "Twitter",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

export function SocialIcon({ platform, className }: { platform: SocialLink["platform"]; className?: string }) {
  const Icon = ICONS[platform];
  return <Icon className={className} />;
}

export function socialLabel(platform: SocialLink["platform"]): string {
  return LABELS[platform];
}
