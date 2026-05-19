import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import type { CtaProps } from "./schema.js";

export function Cta({ heading, body, button_label, button_href, variant }: CtaProps) {
  return (
    <section
      className={cn(
        "ac-cta py-12 px-6 text-center",
        `ac-cta--${variant}`,
        variant === "primary"
          ? "bg-theme-accent text-theme-on-accent"
          : "bg-theme-muted text-theme-on-muted",
      )}
    >
      <div className="ac-cta__inner max-w-3xl mx-auto">
        <h2 className="ac-cta__heading text-3xl md:text-4xl leading-tight mb-3">{heading}</h2>
        {body && <p className="ac-cta__body text-lg leading-relaxed opacity-90 mb-6">{body}</p>}
        <Button asChild size="lg" variant={variant === "primary" ? "secondary" : "primary"}>
          <a href={button_href}>{button_label}</a>
        </Button>
      </div>
    </section>
  );
}
