import type { CtaProps } from "./schema.js";

export function Cta({ heading, body, button_label, button_href, variant }: CtaProps) {
  return (
    <section className={`ac-cta ac-cta--${variant}`}>
      <div className="ac-cta__inner">
        <h2 className="ac-cta__heading">{heading}</h2>
        {body && <p className="ac-cta__body">{body}</p>}
        <a className="ac-cta__button" href={button_href}>
          {button_label}
        </a>
      </div>
    </section>
  );
}
