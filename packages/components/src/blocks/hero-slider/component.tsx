import * as React from "react";
import Autoplay from "embla-carousel-autoplay";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../primitives/carousel.js";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import type { HeroSliderProps } from "./schema.js";

export function HeroSlider({ slides, autoplay, interval_ms, align }: HeroSliderProps) {
  const plugins = React.useMemo(
    () => (autoplay ? [Autoplay({ delay: interval_ms, stopOnInteraction: true })] : []),
    [autoplay, interval_ms],
  );

  return (
    <section className="ac-hero-slider relative bg-theme-main text-theme-on-main">
      <Carousel opts={{ loop: true }} plugins={plugins} className="ac-hero-slider__carousel">
        <CarouselContent>
          {slides.map((s, i) => (
            <CarouselItem key={i}>
              <div
                className={cn(
                  "ac-hero-slider__slide relative py-20 px-6 min-h-[60vh] flex items-center",
                  align === "center" ? "justify-center text-center" : "justify-start text-left",
                )}
                style={s.image ? { backgroundImage: `url(${s.image})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {s.image && (
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
          ))}
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
