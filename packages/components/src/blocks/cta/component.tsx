import * as React from "react";
import { Button } from "../../primitives/button.js";
import { cn } from "../../lib/cn.js";
import { Editable, EditModeContext } from "../../editable.js";
import type { CtaProps } from "./schema.js";

export function Cta({ heading, body, button_label, button_href, variant }: CtaProps) {
  const editMode = React.useContext(EditModeContext);

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
        <Editable
          field="heading"
          as="h2"
          className="ac-cta__heading text-3xl md:text-4xl leading-tight mb-3"
          value={heading}
        />
        <Editable
          field="body"
          as="p"
          className="ac-cta__body text-lg leading-relaxed opacity-90 mb-6"
          value={body}
        />
        {(button_label || editMode) && (
          <Button asChild size="lg" variant={variant === "primary" ? "secondary" : "primary"}>
            <a href={button_href}>
              <Editable
                field="button_label"
                value={button_label}
                placeholder="Add a button label…"
              />
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}
