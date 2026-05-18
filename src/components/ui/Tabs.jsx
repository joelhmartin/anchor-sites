import { useState, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import gsap from "gsap";

/**
 * Reusable Tabs component.
 * - Tab pills: always sticky (all screen sizes), sits below the navbar
 * - Desktop: 2-col layout — image (sticky with pills) | text content (scrolls)
 * - Mobile: stacked — pills (sticky) → image → text
 */
export function Tabs({ tabs, className = "" }) {
  const [active, setActive] = useState(0);
  const contentRef = useRef(null);

  const handleTabChange = (index) => {
    if (index === active) return;

    gsap.to(contentRef.current, {
      opacity: 0,
      y: 10,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => {
        setActive(index);
        gsap.fromTo(
          contentRef.current,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }
        );
      },
    });
  };

  const tab = tabs[active];

  return (
    <div className={className}>
      {/* ── Sticky tab pills — always sticky on all screens ── */}
      <div className="sticky top-[72px] z-20 bg-surface-100 pt-4 pb-4 -mx-1 px-1">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              onClick={() => handleTabChange(i)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 whitespace-nowrap border ${
                active === i
                  ? "bg-brand-500 text-white border-brand-500 shadow-md shadow-brand-500/20"
                  : "bg-white text-navy/60 border-surface-300 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50"
              }`}
            >
              {t.icon && <t.icon size={14} />}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content: 2-col on desktop, stacked on mobile ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-16 mt-6">
        {/* Left: image — sticky on desktop only */}
        <div className="lg:col-span-2 order-1">
          <div className="lg:sticky lg:top-36">
            <div className="relative rounded-3xl overflow-hidden aspect-[4/3] shadow-xl shadow-navy/10">
              <img
                src={tab.image}
                alt={tab.imageAlt || tab.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/30 to-transparent pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Right: text content */}
        <div ref={contentRef} className="lg:col-span-3 order-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
            {tab.subtitle || tab.label}
          </div>

          <h3 className="font-heading font-bold text-2xl md:text-3xl text-navy tracking-tight leading-tight mb-4">
            {tab.title}
          </h3>

          <p className="text-navy/60 text-base leading-relaxed mb-7">
            {tab.description}
          </p>

          {tab.items && tab.items.length > 0 && (
            <ul className="space-y-3">
              {tab.items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2
                    size={16}
                    className="text-brand-500 mt-0.5 flex-shrink-0"
                  />
                  <span className="text-navy/70 text-sm leading-relaxed">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
