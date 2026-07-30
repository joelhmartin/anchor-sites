import * as React from "react";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import { Editable, EditModeContext } from "../../editable.js";
import { useMediaContext, type MediaAssetData } from "../../media-context.js";
import type { SplitHeroProps } from "./schema.js";

function buildSrcset(variants: MediaAssetData["variants"], format: "webp" | "jpg"): string {
  return variants
    .filter((v) => v.format === format)
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(", ");
}

function SplitHeroImage({ asset_id, alt }: { asset_id: string; alt: string }) {
  const ctx = useMediaContext();
  const asset = ctx?.getAsset(asset_id);
  const editMode = React.useContext(EditModeContext);

  if (!asset) {
    return (
      <div
        className="ac-split-hero__image ac-split-hero__image--missing rounded-lg bg-theme-muted"
        data-field="image_asset_id"
        data-ac-image-missing={asset_id || "(empty)"}
        style={{ minHeight: editMode ? 240 : 200, aspectRatio: "4 / 3" }}
      />
    );
  }

  const webpSrcset = buildSrcset(asset.variants, "webp");
  const jpgSrcset = buildSrcset(asset.variants, "jpg");
  const largestJpg = asset.variants
    .filter((v) => v.format === "jpg")
    .slice()
    .sort((a, b) => b.width - a.width)[0];

  return (
    <picture
      className="ac-split-hero__image block rounded-lg overflow-hidden"
      data-field="image_asset_id"
    >
      {webpSrcset && (
        <source type="image/webp" srcSet={webpSrcset} sizes="(min-width: 1024px) 50vw, 100vw" />
      )}
      <img
        className="ac-split-hero__img w-full h-full object-cover"
        src={largestJpg?.url ?? asset.variants[0]?.url}
        srcSet={jpgSrcset || undefined}
        sizes="(min-width: 1024px) 50vw, 100vw"
        alt={alt || asset.alt || ""}
        loading="lazy"
        decoding="async"
        width={asset.width}
        height={asset.height}
      />
    </picture>
  );
}

export function SplitHero({
  eyebrow,
  heading,
  body,
  primary_cta_label,
  primary_cta_href,
  secondary_cta_label,
  secondary_cta_href,
  image_asset_id,
  image_alt,
  variant,
}: SplitHeroProps) {
  const editMode = React.useContext(EditModeContext);
  const imageFirst = variant === "image-left";

  return (
    <section className="ac-split-hero py-16 px-6 bg-theme-main text-theme-on-main overflow-hidden">
      <div className="ac-split-hero__inner max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div
          className={cn(
            "ac-split-hero__media",
            imageFirst ? "lg:order-1" : "lg:order-2",
          )}
        >
          <SplitHeroImage asset_id={image_asset_id} alt={image_alt} />
        </div>
        <div
          className={cn(
            "ac-split-hero__copy",
            imageFirst ? "lg:order-2" : "lg:order-1",
          )}
        >
          <Editable
            field="eyebrow"
            as="p"
            className="ac-split-hero__eyebrow uppercase tracking-wider text-sm opacity-80 mb-3"
            value={eyebrow}
          />
          <Editable
            field="heading"
            as="h1"
            className="ac-split-hero__heading text-3xl md:text-4xl lg:text-5xl leading-tight mb-4"
            value={heading}
          />
          <Editable
            field="body"
            as="p"
            className="ac-split-hero__body text-lg leading-relaxed opacity-90 mb-8 max-w-xl"
            value={body}
          />
          {(primary_cta_label || secondary_cta_label || editMode) && (
            <div className="ac-split-hero__ctas flex flex-wrap items-center gap-4">
              {(primary_cta_label || editMode) && (
                <Button asChild size="lg" variant="primary" className="ac-split-hero__cta-primary">
                  <a href={primary_cta_href}>
                    <Editable
                      field="primary_cta_label"
                      value={primary_cta_label}
                      placeholder="Add a button label…"
                    />
                  </a>
                </Button>
              )}
              {(secondary_cta_label || editMode) && (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="ac-split-hero__cta-secondary"
                >
                  <a href={secondary_cta_href}>
                    <Editable
                      field="secondary_cta_label"
                      value={secondary_cta_label}
                      placeholder="Add a second button…"
                    />
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
