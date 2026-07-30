import * as React from "react";
import { Editable, EditModeContext } from "../../editable.js";
import { FeatureIcon } from "./icons.js";
import type { FeatureGridProps } from "./schema.js";

export function FeatureGrid({ eyebrow, heading, items }: FeatureGridProps) {
  const editMode = React.useContext(EditModeContext);

  return (
    <section className="ac-feature-grid py-16 px-6 bg-theme-surface text-theme-on-surface">
      <div className="ac-feature-grid__inner max-w-6xl mx-auto">
        {(eyebrow || heading || editMode) && (
          <div className="ac-feature-grid__header max-w-2xl mx-auto text-center mb-12">
            <Editable
              field="eyebrow"
              as="p"
              className="ac-feature-grid__eyebrow uppercase tracking-wider text-sm opacity-70 mb-2"
              value={eyebrow}
            />
            <Editable
              field="heading"
              as="h2"
              className="ac-feature-grid__heading text-3xl md:text-4xl leading-tight"
              value={heading}
            />
          </div>
        )}
        <div className="ac-feature-grid__items grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
          {items.map((item, i) => (
            <div key={i} className="ac-feature-grid__item">
              <div className="ac-feature-grid__icon inline-flex items-center justify-center h-12 w-12 rounded-lg bg-theme-accent text-theme-on-accent mb-4">
                <FeatureIcon icon={item.icon} className="h-6 w-6" />
              </div>
              <h3 className="ac-feature-grid__item-title text-lg font-semibold mb-2">
                {item.title}
              </h3>
              {item.body && (
                <p className="ac-feature-grid__item-body leading-relaxed opacity-80">
                  {item.body}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
