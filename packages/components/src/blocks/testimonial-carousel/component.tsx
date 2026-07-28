import * as React from "react";
import Autoplay from "embla-carousel-autoplay";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../primitives/carousel.js";
import { Card, CardContent } from "../../primitives/card.js";
import { Editable } from "../../editable.js";
import type { TestimonialCarouselProps } from "./schema.js";

export function TestimonialCarousel({
  heading,
  items,
  autoplay,
  interval_ms,
}: TestimonialCarouselProps) {
  const plugins = React.useMemo(
    () => (autoplay ? [Autoplay({ delay: interval_ms, stopOnInteraction: true })] : []),
    [autoplay, interval_ms],
  );

  return (
    <section className="ac-testimonial-carousel py-16 px-6 bg-theme-surface text-theme-on-surface">
      <div className="ac-testimonial-carousel__inner max-w-4xl mx-auto">
        <Editable
          field="heading"
          as="h2"
          className="ac-testimonial-carousel__heading text-3xl text-center mb-8"
          value={heading}
        />
        <Carousel opts={{ loop: items.length > 1 }} plugins={plugins}>
          <CarouselContent>
            {items.map((t, i) => (
              <CarouselItem key={i}>
                <Card className="ac-testimonial-carousel__card mx-2">
                  <CardContent className="pt-6 text-center">
                    <blockquote className="ac-testimonial-carousel__quote text-lg italic mb-4">
                      &ldquo;{t.quote}&rdquo;
                    </blockquote>
                    <div className="ac-testimonial-carousel__attribution flex items-center justify-center gap-3">
                      {t.avatar && (
                        <img
                          src={t.avatar}
                          alt=""
                          className="ac-testimonial-carousel__avatar h-12 w-12 rounded-full object-cover"
                        />
                      )}
                      <div className="text-left">
                        <p className="ac-testimonial-carousel__author font-semibold">{t.author}</p>
                        {t.role && (
                          <p className="ac-testimonial-carousel__role text-sm opacity-70">
                            {t.role}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          {items.length > 1 && (
            <>
              <CarouselPrevious />
              <CarouselNext />
            </>
          )}
        </Carousel>
      </div>
    </section>
  );
}
