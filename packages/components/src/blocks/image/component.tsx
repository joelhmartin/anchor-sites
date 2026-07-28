import * as React from "react";
import { cn } from "../../lib/cn.js";
import { useMediaContext, type MediaVariant } from "../../media-context.js";
import { EditModeContext } from "../../editable.js";
import type { ImageProps } from "./schema.js";

function buildSrcset(variants: MediaVariant[]): string {
  return variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(", ");
}

export function Image({ asset_id, alt, focal_point, fit, aspect_ratio, sizes }: ImageProps) {
  const ctx = useMediaContext();
  const asset = ctx?.getAsset(asset_id);
  const editMode = React.useContext(EditModeContext);

  if (!asset) {
    // Render a stable placeholder. Per-block error styling is intentionally
    // muted in prod (the renderer's BlockRenderer takes care of the
    // visible-vs-silent decision; we just emit a small marker). In edit mode
    // it also needs a minimum height so the overlay has something to click.
    return (
      <picture
        className={cn("ac-image ac-image--missing")}
        data-field="asset_id"
        data-ac-image-missing={asset_id || "(empty)"}
        style={editMode ? { minHeight: 80 } : undefined}
      />
    );
  }

  const webp = asset.variants.filter((v) => v.format === "webp");
  const jpg = asset.variants.filter((v) => v.format === "jpg");
  const webpSrcset = buildSrcset(webp);
  const jpgSrcset = buildSrcset(jpg);
  const largestJpg = jpg.slice().sort((a, b) => b.width - a.width)[0];
  if (!largestJpg) {
    return (
      <picture
        className={cn("ac-image ac-image--missing-variants")}
        data-ac-image-missing-variants={asset_id}
      />
    );
  }

  const effectiveFp = focal_point ?? asset.focal_point ?? null;
  const objectPosition = effectiveFp
    ? `${(effectiveFp.x * 100).toFixed(2)}% ${(effectiveFp.y * 100).toFixed(2)}%`
    : undefined;
  const objectFit = fit;
  const resolvedAlt = alt || asset.alt || "";

  const wrapperStyle: React.CSSProperties = {};
  if (aspect_ratio) wrapperStyle.aspectRatio = String(aspect_ratio);

  return (
    <picture
      className={cn("ac-image", `ac-image--fit-${fit}`)}
      data-field="asset_id"
      style={wrapperStyle}
    >
      {webpSrcset && <source type="image/webp" srcSet={webpSrcset} sizes={sizes || undefined} />}
      <img
        className="ac-image__img"
        src={largestJpg.url}
        srcSet={jpgSrcset}
        sizes={sizes || undefined}
        alt={resolvedAlt}
        loading="lazy"
        decoding="async"
        width={asset.width}
        height={asset.height}
        style={{ objectFit, objectPosition }}
      />
    </picture>
  );
}
