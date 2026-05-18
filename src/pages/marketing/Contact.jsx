import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { SITE, SERVICES_NAV } from "../../config/site.js";
import { AUSTIN } from "../../config/images.js";

/* ── Scroll reveal helper ── */
function useScrollReveal(ref, selector, animProps) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll(selector);
    if (!targets.length) return;

    gsap.set(targets, { opacity: 0, y: animProps.y ?? 24 });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          gsap.to(targets, {
            opacity: 1,
            y: 0,
            duration: animProps.duration ?? 0.8,
            stagger: animProps.stagger ?? 0.08,
            ease: animProps.ease ?? "power3.out",
          });
          observer.disconnect();
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
}

/* ─── HERO ─── */
function ContactHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-chero]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.3,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative h-[45dvh] min-h-[350px] flex items-end overflow-hidden"
    >
      <div className="absolute inset-0">
        <img
          src={AUSTIN.streetCrossing}
          alt="City street"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
      </div>
      <div className="relative z-10 section-pad pb-12 md:pb-16 max-w-3xl">
        <span
          data-chero
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-white/60 text-xs font-mono tracking-wider"
        >
          Contact Us
        </span>
        <h1 data-chero className="mt-5">
          <span className="block font-heading font-bold text-3xl sm:text-4xl md:text-6xl tracking-tight leading-[0.95] text-white">
            Let&apos;s start the
          </span>
          <span className="block font-drama italic text-4xl sm:text-5xl md:text-8xl tracking-tight leading-[0.9] text-brand-400">
            conversation.
          </span>
        </h1>
      </div>
    </section>
  );
}

/* ─── CONTACT FORM ─── */
function ContactForm() {
  const [formState, setFormState] = useState("idle");
  const [focused, setFocused] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormState("sending");
    setTimeout(() => setFormState("success"), 1500);
    setTimeout(() => setFormState("idle"), 4000);
  };

  const fields = [
    { name: "name", label: "Full Name", type: "text" },
    { name: "email", label: "Email Address", type: "email" },
    { name: "phone", label: "Phone Number", type: "tel" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {fields.map((field) => (
          <div
            key={field.name}
            className={field.name === "name" ? "sm:col-span-2" : ""}
          >
            <div className="relative">
              <label
                className={`absolute left-4 transition-all duration-300 pointer-events-none ${
                  focused[field.name]
                    ? "top-2 text-[10px] text-brand-500 font-semibold"
                    : "top-4 text-sm text-navy/40"
                }`}
              >
                {field.label}
              </label>
              <input
                type={field.type}
                name={field.name}
                className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300"
                onFocus={() =>
                  setFocused((prev) => ({ ...prev, [field.name]: true }))
                }
                onBlur={(e) => {
                  if (!e.target.value)
                    setFocused((prev) => ({ ...prev, [field.name]: false }));
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <label
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            focused.inquiry
              ? "top-2 text-[10px] text-brand-500 font-semibold"
              : "top-4 text-sm text-navy/40"
          }`}
        >
          I&apos;m reaching out about...
        </label>
        <select
          name="inquiry"
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300 appearance-none cursor-pointer"
          onFocus={() => setFocused((prev) => ({ ...prev, inquiry: true }))}
          onBlur={(e) => {
            if (!e.target.value)
              setFocused((prev) => ({ ...prev, inquiry: false }));
          }}
          defaultValue=""
        >
          <option value="" disabled></option>
          {SERVICES_NAV.map((svc) => (
            <option key={svc.to}>{svc.label}</option>
          ))}
          <option>General Inquiry</option>
        </select>
      </div>

      <div className="relative">
        <label
          className={`absolute left-4 transition-all duration-300 pointer-events-none ${
            focused.message
              ? "top-2 text-[10px] text-brand-500 font-semibold"
              : "top-4 text-sm text-navy/40"
          }`}
        >
          Tell us about your project
        </label>
        <textarea
          name="message"
          rows={5}
          className="w-full pt-6 pb-2 px-4 rounded-2xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all duration-300 resize-none"
          onFocus={() => setFocused((prev) => ({ ...prev, message: true }))}
          onBlur={(e) => {
            if (!e.target.value)
              setFocused((prev) => ({ ...prev, message: false }));
          }}
        />
      </div>

      <p className="text-navy/35 text-xs leading-relaxed">
        All inquiries are confidential. We typically respond within 24 hours.
      </p>

      <button
        type="submit"
        disabled={formState !== "idle"}
        className={`btn-magnetic w-full py-4 rounded-full font-semibold text-sm transition-all duration-500 ${
          formState === "success"
            ? "bg-emerald-500 text-white"
            : "bg-brand-500 text-white"
        }`}
      >
        <span className="btn-bg bg-brand-600 rounded-full" />
        <span className="relative z-10 flex items-center justify-center gap-2">
          {formState === "idle" && (
            <>
              Send Message <Send size={16} />
            </>
          )}
          {formState === "sending" && (
            <>
              Sending <Loader2 size={16} className="animate-spin" />
            </>
          )}
          {formState === "success" && (
            <>
              Message Sent <CheckCircle size={16} />
            </>
          )}
        </span>
      </button>
    </form>
  );
}

/* ─── CONTACT INFO ─── */
function ContactInfo() {
  const items = [
    { icon: Phone,  label: "Phone",    value: SITE.phone,    href: SITE.phoneHref },
    { icon: Mail,   label: "Email",    value: SITE.email,    href: SITE.emailHref },
    { icon: MapPin, label: "Location", value: SITE.location },
    { icon: Clock,  label: "Hours",    value: SITE.hours },
  ];

  return (
    <div>
      <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight">
        Get in touch.
      </h2>
      <p className="mt-3 text-navy/50 text-sm leading-relaxed max-w-sm">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent
        commodo cursus magna, vel scelerisque nisl consectetur.
      </p>

      <div className="mt-8 space-y-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0">
              <item.icon size={16} className="text-brand-500" />
            </div>
            <div>
              <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
                {item.label}
              </span>
              {item.href ? (
                <a
                  href={item.href}
                  className="block text-sm font-medium text-navy/80 hover:text-brand-500 transition-colors"
                >
                  {item.value}
                </a>
              ) : (
                <p className="text-sm font-medium text-navy/80">{item.value}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Social links */}
      <div className="mt-8 pt-6 border-t border-surface-300/30">
        <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
          Follow Us
        </span>
        <div className="mt-3 flex items-center gap-3">
          {SITE.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-2xl bg-surface-100 border border-surface-300/50 flex items-center justify-center text-navy/40 hover:text-brand-500 hover:border-brand-300 transition-all duration-300"
              aria-label={s.label}
            >
              <s.icon size={16} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── PAGE EXPORT ─── */
export function ContactPage() {
  const sectionRef = useRef(null);
  useScrollReveal(sectionRef, "[data-contact-anim]", {
    y: 40,
    duration: 0.8,
    stagger: 0.1,
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div ref={sectionRef}>
      <ContactHero />

      <section className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <div
            data-contact-anim
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16"
          >
            <ContactInfo />
            <div className="bg-white rounded-3xl p-6 md:p-8 border border-surface-200/60 shadow-sm">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      {/* Ambient image */}
      <section className="section-pad pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="relative w-full aspect-[21/9] rounded-3xl overflow-hidden">
            <img
              src={AUSTIN.ladyBirdAerial}
              alt="Aerial cityscape"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-brand-500/20 to-navy/30" />
          </div>
        </div>
      </section>
    </div>
  );
}
