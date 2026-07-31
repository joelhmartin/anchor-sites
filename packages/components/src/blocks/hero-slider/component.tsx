import * as React from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../primitives/carousel.js";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import { useMediaContext, type MediaAssetData } from "../../media-context.js";
import type { HeroSlide, HeroSliderProps } from "./schema.js";

/**
 * Pick the largest WebP variant (falling back to largest JPG) so the
 * background image is high-fidelity without the SSR'd `<picture>`
 * overhead — the slide's background-image is a CSS property, not a
 * `<picture>`. Real `<picture>` rendering for non-background imagery
 * uses the `<Image>` block.
 */
function bestBgUrl(asset: MediaAssetData): string | undefined {
  const sorted = asset.variants.slice().sort((a, b) => b.width - a.width);
  const webp = sorted.find((v) => v.format === "webp");
  return (webp ?? sorted[0])?.url;
}

function SlideBackground({
  slide,
  resolveAsset,
}: {
  slide: HeroSlide;
  resolveAsset: (id: string) => MediaAssetData | undefined;
}): { style: React.CSSProperties | undefined; showOverlay: boolean } {
  if (slide.image_asset_id) {
    const asset = resolveAsset(slide.image_asset_id);
    const url = asset ? bestBgUrl(asset) : undefined;
    if (url) {
      return {
        style: {
          backgroundImage: `url(${url})`,
          backgroundSize: "cover",
          backgroundPosition: asset?.focal_point
            ? `${(asset.focal_point.x * 100).toFixed(2)}% ${(asset.focal_point.y * 100).toFixed(2)}%`
            : "center",
        },
        showOverlay: true,
      };
    }
    // image_asset_id set but asset missing → fall through to legacy URL
    // (if any), so editors can preview while uploads are in flight.
  }
  if (slide.image) {
    return {
      style: {
        backgroundImage: `url(${slide.image})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
      showOverlay: true,
    };
  }
  return { style: undefined, showOverlay: false };
}

export function HeroSlider({ slides, autoplay, interval_ms, align }: HeroSliderProps) {
  const ctx = useMediaContext();
  const resolveAsset = (id: string) => ctx?.getAsset(id);

  return (
    <section className="ac-hero-slider relative bg-theme-main text-theme-on-main">
      {/* D1200 — scroll-snap carousel: swiping works with zero JS; the
          primitive's inline island adds arrows/loop/autoplay where allowed. */}
      <Carousel
        loop
        autoplayMs={autoplay ? interval_ms : undefined}
        className="ac-hero-slider__carousel"
      >
        <CarouselContent>
          {slides.map((s, i) => {
            const { style, showOverlay } = SlideBackground({ slide: s, resolveAsset });
            return (
            <CarouselItem key={i}>
              <div
                className={cn(
                  "ac-hero-slider__slide relative py-20 px-6 min-h-[60vh] flex items-center",
                  align === "center" ? "justify-center text-center" : "justify-start text-left",
                )}
                style={style}
              >
                {showOverlay && (
                  <div aria-hidden="true" className="absolute inset-0 bg-theme-main opacity-50" />
                )}
                <div className="ac-hero-slider__slide-inner relative max-w-4xl mx-auto">
                  {s.eyebrow && (
                    <p className="ac-hero-slider__eyebrow uppercase tracking-wider text-sm opacity-80 mb-2">
                      {s.eyebrow}
                    </p>
                  )}
                  <h2 className="ac-hero-slider__title text-4xl md:text-5xl leading-tight mb-4">
                    {s.title}
                  </h2>
                  {s.subtitle && (
                    <p className="ac-hero-slider__subtitle text-lg leading-relaxed opacity-90 mb-6">
                      {s.subtitle}
                    </p>
                  )}
                  {s.cta_label && (
                    <Button asChild size="lg" variant="primary">
                      <a href={s.cta_href || "#"}>{s.cta_label}</a>
                    </Button>
                  )}
                </div>
              </div>
            </CarouselItem>
            );
          })}
        </CarouselContent>
        {slides.length > 1 && (
          <>
            <CarouselPrevious />
            <CarouselNext />
          </>
        )}
      </Carousel>
    </section>
  );
}
