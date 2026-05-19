import type { HeroProps } from "./schema.js";

export function Hero({ eyebrow, title, subtitle, cta_label, cta_href, align }: HeroProps) {
  return (
    <section className={`ac-hero ac-hero--align-${align}`}>
      <div className="ac-hero__inner">
        {eyebrow && <p className="ac-hero__eyebrow">{eyebrow}</p>}
        <h1 className="ac-hero__title">{title}</h1>
        {subtitle && <p className="ac-hero__subtitle">{subtitle}</p>}
        {cta_label && (
          <a className="ac-hero__cta" href={cta_href}>
            {cta_label}
          </a>
        )}
      </div>
    </section>
  );
}
