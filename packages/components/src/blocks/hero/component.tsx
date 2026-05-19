import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import type { HeroProps } from "./schema.js";

export function Hero({ eyebrow, title, subtitle, cta_label, cta_href, align }: HeroProps) {
  return (
    <section
      className={cn(
        "ac-hero py-16 px-6 bg-theme-main text-theme-on-main",
        `ac-hero--align-${align}`,
      )}
    >
      <div
        className={cn(
          "ac-hero__inner max-w-4xl mx-auto",
          align === "center" ? "text-center" : "text-left",
        )}
      >
        {eyebrow && (
          <p className="ac-hero__eyebrow uppercase tracking-wider text-sm opacity-80 mb-2">
            {eyebrow}
          </p>
        )}
        <h1 className="ac-hero__title text-4xl md:text-5xl leading-tight mb-4">
          {title}
        </h1>
        {subtitle && (
          <p className="ac-hero__subtitle text-lg leading-relaxed opacity-90 mb-6">
            {subtitle}
          </p>
        )}
        {cta_label && (
          <Button asChild size="lg" variant="primary" className="ac-hero__cta">
            <a href={cta_href}>{cta_label}</a>
          </Button>
        )}
      </div>
    </section>
  );
}
