import * as React from "react";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import { Editable, EditModeContext } from "../../editable.js";
import { useMediaContext, type MediaAssetData } from "../../media-context.js";
import type { NavBarProps } from "./schema.js";

/**
 * Fix round 1 (review): the previous version picked the FIRST webp variant
 * off an ascending sort — i.e. the smallest one — leaving the logo soft on
 * retina displays even when a larger source was available. Pick the
 * largest webp (falling back to the largest of any format) for `src`, and
 * build a full webp `srcSet` so the browser can choose a higher-density
 * asset itself, same intent as `split-hero`'s image resolution.
 */
function sortedByWidth(variants: MediaAssetData["variants"]) {
  return variants.slice().sort((a, b) => a.width - b.width);
}

function bestLogoUrl(asset: MediaAssetData): string | undefined {
  const webp = sortedByWidth(asset.variants).filter((v) => v.format === "webp");
  const largestWebp = webp[webp.length - 1];
  if (largestWebp) return largestWebp.url;
  const anyFormat = sortedByWidth(asset.variants);
  return anyFormat[anyFormat.length - 1]?.url;
}

function logoSrcSet(asset: MediaAssetData): string | undefined {
  const webp = sortedByWidth(asset.variants).filter((v) => v.format === "webp");
  if (webp.length < 2) return undefined;
  return webp.map((v) => `${v.url} ${v.width}w`).join(", ");
}

export function NavBar({
  brand_name,
  logo_asset_id,
  links,
  cta_label,
  cta_href,
  variant,
}: NavBarProps) {
  const editMode = React.useContext(EditModeContext);
  const ctx = useMediaContext();
  const asset = logo_asset_id ? ctx?.getAsset(logo_asset_id) : undefined;
  const logoUrl = asset ? bestLogoUrl(asset) : undefined;
  const logoSrcSetValue = asset ? logoSrcSet(asset) : undefined;

  const brand = (
    <a
      href="/"
      className="ac-nav-bar__brand inline-flex items-center gap-2 font-semibold text-lg"
    >
      {logoUrl && (
        <img
          src={logoUrl}
          srcSet={logoSrcSetValue}
          sizes={logoSrcSetValue ? "64px" : undefined}
          alt={asset?.alt || brand_name}
          className="ac-nav-bar__logo h-8 w-auto"
          loading="lazy"
          decoding="async"
        />
      )}
      <Editable field="brand_name" value={brand_name} />
    </a>
  );

  const linkList = (
    <ul
      className={cn(
        "ac-nav-bar__links flex flex-wrap items-center gap-x-6 gap-y-2 list-none p-0 m-0",
        variant === "centered" && "justify-center",
      )}
    >
      {links.map((link, i) => (
        <li key={i}>
          <a href={link.href} className="text-sm font-medium opacity-80 hover:opacity-100 transition-opacity">
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );

  const ctaButton = (variant === "cta" && (cta_label || editMode)) ? (
    <Button asChild size="md" variant="primary" className="ac-nav-bar__cta w-full sm:w-auto">
      <a href={cta_href}>
        <Editable field="cta_label" value={cta_label} placeholder="Add a button label…" />
      </a>
    </Button>
  ) : null;

  return (
    <header
      className={cn(
        "ac-nav-bar py-4 px-6 bg-theme-surface text-theme-on-surface border-b border-theme-border",
        `ac-nav-bar--${variant}`,
      )}
    >
      <div
        className={cn(
          "ac-nav-bar__inner max-w-6xl mx-auto",
          variant === "centered"
            ? "flex flex-col items-center gap-4"
            : "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6",
        )}
      >
        {brand}
        <div className="ac-nav-bar__right flex flex-wrap items-center gap-4 sm:gap-6">
          <nav aria-label="Primary">{linkList}</nav>
          {ctaButton}
        </div>
      </div>
    </header>
  );
}
