import { cn } from "../../lib/cn.js";
import { Editable } from "../../editable.js";
import type { LogoReelProps, LogoEntry } from "./schema.js";

function LogoItem({ logo }: { logo: LogoEntry }) {
  const img = (
    <img
      src={logo.src}
      alt={logo.alt}
      className="ac-logo-reel__logo h-10 md:h-12 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
    />
  );
  if (logo.href) {
    return (
      <a href={logo.href} className="ac-logo-reel__link shrink-0 px-8" aria-label={logo.alt || undefined}>
        {img}
      </a>
    );
  }
  return <div className="ac-logo-reel__item shrink-0 px-8">{img}</div>;
}

export function LogoReel({ heading, logos, speed_seconds }: LogoReelProps) {
  // Duplicate the list once so a CSS translate of -50% loops seamlessly.
  const doubled = [...logos, ...logos];
  const style = { "--ac-logo-reel-duration": `${speed_seconds}s` } as React.CSSProperties;

  return (
    <section className="ac-logo-reel py-10 bg-theme-surface text-theme-on-surface">
      <Editable
        field="heading"
        as="h2"
        className="ac-logo-reel__heading text-center text-sm uppercase tracking-wider opacity-70 mb-6"
        value={heading}
      />
      <div className={cn("ac-logo-reel__viewport overflow-hidden")} style={style}>
        <div className="ac-logo-reel__track flex items-center w-max">
          {doubled.map((logo, i) => (
            <LogoItem key={i} logo={logo} />
          ))}
        </div>
      </div>
    </section>
  );
}
