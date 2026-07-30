import * as React from "react";
import { Editable, EditModeContext } from "../../editable.js";
import { SocialIcon, socialLabel } from "./social-icons.js";
import type { RichFooterProps } from "./schema.js";

export function RichFooter({
  brand_name,
  tagline,
  columns,
  social_links,
  hours,
  small_print,
}: RichFooterProps) {
  const editMode = React.useContext(EditModeContext);

  return (
    <footer className="ac-rich-footer bg-theme-main text-theme-on-main">
      <div className="ac-rich-footer__inner max-w-6xl mx-auto px-6 py-16">
        <div className="ac-rich-footer__top flex flex-col lg:flex-row lg:flex-wrap gap-10 lg:gap-12 pb-12">
          <div className="ac-rich-footer__brand lg:flex-[1.5] lg:min-w-[240px]">
            {(brand_name || editMode) && (
              <Editable
                field="brand_name"
                as="p"
                className="ac-rich-footer__brand-name text-lg font-semibold mb-2"
                value={brand_name}
              />
            )}
            {(tagline || editMode) && (
              <Editable
                field="tagline"
                as="p"
                className="ac-rich-footer__tagline text-sm opacity-80 mb-4 max-w-xs"
                value={tagline}
              />
            )}
            {(hours || editMode) && (
              <Editable
                field="hours"
                as="p"
                className="ac-rich-footer__hours text-sm opacity-80 mb-4 whitespace-pre-line"
                value={hours}
                placeholder="Add business hours…"
              />
            )}
            {social_links.length > 0 && (
              <ul className="ac-rich-footer__social flex items-center gap-3 mt-2 list-none p-0">
                {social_links.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.href}
                      aria-label={socialLabel(s.platform)}
                      className="ac-rich-footer__social-link inline-flex h-8 w-8 items-center justify-center rounded-full opacity-80 hover:opacity-100 transition-opacity"
                    >
                      <SocialIcon platform={s.platform} className="h-4 w-4" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {columns.map((col, i) => (
            <nav
              key={i}
              aria-label={col.heading || `Footer links ${i + 1}`}
              className="ac-rich-footer__column lg:flex-1 lg:min-w-[140px]"
            >
              {col.heading && (
                <h3 className="ac-rich-footer__column-heading text-sm font-semibold uppercase tracking-wide mb-3 opacity-90">
                  {col.heading}
                </h3>
              )}
              <ul className="ac-rich-footer__column-links flex flex-col gap-2 list-none p-0">
                {col.links.map((link, j) => (
                  <li key={j}>
                    <a href={link.href} className="text-sm opacity-80 hover:opacity-100 transition-opacity">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {(small_print || editMode) && (
          <div className="ac-rich-footer__bottom border-t border-theme-border pt-6">
            <Editable
              field="small_print"
              as="p"
              className="ac-rich-footer__small-print text-xs opacity-70"
              value={small_print}
              placeholder="Add copyright / small print…"
            />
          </div>
        )}
      </div>
    </footer>
  );
}
