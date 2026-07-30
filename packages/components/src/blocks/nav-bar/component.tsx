import * as React from "react";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import { Editable, EditModeContext } from "../../editable.js";
import { useMediaContext, type MediaAssetData } from "../../media-context.js";
import type { NavBarProps } from "./schema.js";

function bestLogoUrl(asset: MediaAssetData): string | undefined {
  const sorted = asset.variants.slice().sort((a, b) => a.width - b.width);
  const webp = sorted.find((v) => v.format === "webp");
  return (webp ?? sorted[0])?.url;
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

  const brand = (
    <a
      href="/"
      className="ac-nav-bar__brand inline-flex items-center gap-2 font-semibold text-lg"
    >
      {logoUrl && (
        <img
          src={logoUrl}
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
    <Button asChild size="md" variant="primary" className="ac-nav-bar__cta">
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
            : "flex items-center justify-between gap-6",
        )}
      >
        {brand}
        <div className="ac-nav-bar__right flex items-center gap-6">
          <nav aria-label="Primary">{linkList}</nav>
          {ctaButton}
        </div>
      </div>
    </header>
  );
}
