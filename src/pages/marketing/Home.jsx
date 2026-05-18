import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  Heart,
  Users,
  GitBranch,
  Wrench,
  Scale,
  MapPin,
  UserCheck,
  Brain,
  Home,
  Stethoscope,
  Compass,
} from "lucide-react";
import Lottie from "lottie-react";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { AUSTIN, SERVICES, TEAM } from "../../config/images.js";
import { BUSINESS, SERVICES_NAV } from "../../config/site.js";
import { Responsive } from "../../hooks/useBreakpoint.jsx";

/* ── Scroll reveal helper ─────────────────────
   Uses IntersectionObserver instead of GSAP
   ScrollTrigger to avoid layout-shift issues
   with externally loaded images.
──────────────────────────────────────────── */
function useScrollReveal(ref, selector, animProps) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll(selector);
    if (!targets.length) return;

    // Keep targets invisible until observer fires
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

/* ─────────────────────────────────────────────
   NOISE OVERLAY
───────────────────────────────────────────── */
function NoiseOverlay() {
  return (
    <svg className="noise-overlay" width="100%" height="100%">
      <filter id="noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.75"
          numOctaves="4"
          stitchTiles="stitch"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#noise)" />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   HERO
───────────────────────────────────────────── */
function Hero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-hero-anim]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.3,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  /* Build ticker string from config services */
  const tickerText = SERVICES_NAV.map((s) => s.label).join("\u00A0\u00A0\u2022\u00A0\u00A0") + "\u00A0\u00A0\u2022\u00A0\u00A0";

  return (
    <section
      ref={heroRef}
      className="relative min-h-[100dvh] flex items-end"
    >
      {/* Background */}
      <div className="absolute inset-0">

        <Responsive>{(bp) =>
          <img
            src={bp.isMobile ? TEAM.heroMobile : TEAM.heroMain}
            alt={`${BUSINESS.name} team`}
            className="w-full h-full object-cover object-center"
          />
        }</Responsive>
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />
        <NoiseOverlay />
      </div>

      {/* Content */}
      <div className="relative z-10 section-pad pt-60 md:pt-48 pb-16 md:pb-28 max-w-6xl">
        {/* Eyebrow — news ticker */}
        <div data-hero-anim className="mb-6">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 max-w-[90vw] sm:max-w-md overflow-hidden">
            {/* Pulsing dot */}
            <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-400" />
            </span>
            {/* Scrolling ticker */}
            <div className="overflow-hidden flex-1">
              <div className="ticker-track">
                <span className="text-white/70 text-xs font-mono tracking-wider whitespace-nowrap">
                  {tickerText}
                </span>
                <span className="text-white/70 text-xs font-mono tracking-wider whitespace-nowrap">
                  {tickerText}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <h1 data-hero-anim>
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[0.95] text-white">
            Lorem Ipsum Dolor.
          </span>
          <span className="block font-drama italic text-5xl sm:text-6xl md:text-7xl lg:text-[8rem] tracking-tight leading-[0.85] text-brand-400">
            Sit Amet Elit.
          </span>
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1] text-white mt-1">
            Consectetur Adipiscing.
          </span>
        </h1>

        {/* Sub */}
        <p
          data-hero-anim
          className="mt-7 text-white/60 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim
          ad minim veniam, quis nostrud exercitation ullamco.
        </p>

        {/* CTAs */}
        <div data-hero-anim className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/contact"
            className="btn-magnetic group px-7 py-3.5 rounded-full bg-brand-500 text-white font-semibold text-sm"
          >
            <span className="btn-bg bg-brand-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              Get Started
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </Link>
          <a
            href="#services"
            className="px-7 py-3.5 rounded-full border border-white/20 text-white/80 font-medium text-sm hover:bg-white/10 transition-colors duration-300"
          >
            Our Services
          </a>
        </div>

        {/* Values strip */}
        <div
          data-hero-anim
          className="mt-12 flex items-center flex-wrap gap-x-8 gap-y-2 text-white/35 text-xs font-mono"
        >
          {["Lorem", "Ipsum", "Dolor", "Amet"].map(
            (v, i, arr) => (
              <span key={v} className="flex items-center gap-8">
                {v}
                {i < arr.length - 1 && (
                  <span className="w-1 h-1 rounded-full bg-white/20" />
                )}
              </span>
            )
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   MISSION
───────────────────────────────────────────── */
function Mission() {
  const ref = useRef(null);
  const [winkData, setWinkData] = useState(null);
  useScrollReveal(ref, "[data-mission-anim]", { y: 32, duration: 0.9, stagger: 0.12 });

  useEffect(() => {
    fetch("/lottie/logo-animation.json")
      .then((r) => r.json())
      .then(setWinkData)
      .catch(() => {});
  }, []);

  return (
    <section ref={ref} className="relative section-pad py-24 md:py-32">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        {/* Photo */}
        <div data-mission-anim className="relative order-2 lg:order-1">
          <div className="relative rounded-3xl overflow-hidden aspect-[4/4]">
            <img
              src={TEAM.teamIsoBg}
              alt={`${BUSINESS.name} team`}
              className="w-full h-full object-contain object-center"
            />
          </div>
          {/* Floating badge */}
          <div className="absolute -bottom-5 -right-5 md:right-6 bg-white rounded-2xl px-6 py-4 shadow-xl border border-surface-200/80">
            <p className="font-heading font-bold text-3xl text-brand-500 leading-none">
              Lorem Ipsum
            </p>
            <p className="text-navy/50 text-sm mt-0.5">Dolor Sit Amet</p>
          </div>
        </div>

        {/* Text */}
        <div className="order-1 lg:order-2">
          <div data-mission-anim className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
            Our Mission
          </div>

          <h2
            data-mission-anim
            className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight mb-6"
          >
            Lorem ipsum dolor sit—
            <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">
              {" "}amet consectetur{" "}
            </span>
            adipiscing elit.
          </h2>

          <p data-mission-anim className="text-navy/60 text-base leading-relaxed mb-5">
            Praesent commodo cursus magna, vel scelerisque nisl consectetur et.
            Donec sed odio dui. Maecenas faucibus mollis interdum.
          </p>
          <p data-mission-anim className="text-navy/60 text-base leading-relaxed mb-8">
            Maecenas sed diam eget risus varius blandit sit amet non magna.
            Integer posuere erat a ante venenatis dapibus posuere velit aliquet.
            Cras mattis consectetur purus sit amet fermentum. Nullam quis risus
            eget urna mollis ornare vel eu leo.
          </p>

          <div data-mission-anim>
            <Link
              to="/about"
              className="inline-flex items-center gap-2 text-brand-500 font-semibold text-sm hover:gap-3 transition-all duration-300"
            >
              Learn More About Us
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   SERVICES TABS
   Labels driven by SERVICES_NAV from config.
───────────────────────────────────────────── */
const SERVICE_IMAGES = [
  SERVICES.coaching,
  SERVICES.soberCompanion,
  AUSTIN.ladyBirdAerial,
  SERVICES.family,
  SERVICES.collaborative,
];

const SERVICE_TABS = SERVICES_NAV.map((svc, i) => ({
  id: svc.to.split("/").pop(),
  label: svc.label,
  subtitle: svc.label,
  title: "Lorem Ipsum Dolor Sit Amet Consectetur Adipiscing",
  description:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus luctus urna sed urna ultricies ac tempor dui sagittis. In condimentum facilisis porta. Sed nec diam eu diam mattis viverra.",
  items: [
    "Praesent commodo cursus magna vel scelerisque",
    "Donec sed odio dui maecenas faucibus mollis",
    "Integer posuere erat a ante venenatis dapibus",
    "Cras mattis consectetur purus sit amet fermentum",
    "Nullam quis risus eget urna mollis ornare",
    "Vestibulum id ligula porta felis euismod semper",
  ],
  image: SERVICE_IMAGES[i] || SERVICE_IMAGES[0],
  imageAlt: svc.label,
}));

function Services() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-services-hdr]", { y: 28, duration: 0.9, stagger: 0.1 });

  return (
    <section id="services" ref={ref} className="section-pad py-24 md:py-32 bg-surface-100">
      <div data-services-hdr className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
        Our Services
      </div>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-14">
        <h2
          data-services-hdr
          className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight max-w-xl"
        >
          Lorem ipsum dolor sit{" "}
          <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">
            amet consectetur
          </span>
        </h2>
        <p
          data-services-hdr
          className="text-navy/50 text-sm max-w-xs leading-relaxed"
        >
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
          eiusmod tempor incididunt.
        </p>
      </div>

      <Tabs tabs={SERVICE_TABS} />
    </section>
  );
}

/* ─────────────────────────────────────────────
   WHO WE SERVE
───────────────────────────────────────────── */
const WHO_WE_SERVE = [
  {
    icon: Brain,
    title: "Lorem Ipsum",
    desc: "Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod.",
  },
  {
    icon: Heart,
    title: "Dolor Sit Amet",
    desc: "Maecenas sed diam eget risus varius blandit sit amet non magna. Integer posuere erat a ante.",
  },
  {
    icon: UserCheck,
    title: "Consectetur Elit",
    desc: "Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod.",
  },
  {
    icon: GitBranch,
    title: "Praesent Commodo",
    desc: "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Aenean lacinia bibendum.",
  },
  {
    icon: Home,
    title: "Vivamus Sagittis",
    desc: "Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.",
  },
  {
    icon: Users,
    title: "Aenean Lacinia",
    desc: "Nullam quis risus eget urna mollis ornare vel eu leo. Morbi leo risus porta ac consectetur.",
  },
];

function WhoWeServe() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-who-card]", { y: 24, duration: 0.8, stagger: 0.08 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
          Who We Serve
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight">
          Lorem ipsum is{" "}
          <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">not linear</span>
          —dolor sit amet consectetur.
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {WHO_WE_SERVE.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            data-who-card
            className="bg-white rounded-3xl p-7 border border-surface-200/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
          >
            <div className="w-10 h-10 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
              <Icon size={18} className="text-brand-500" />
            </div>
            <h3 className="font-heading font-bold text-base text-navy mb-2">
              {title}
            </h3>
            <p className="text-navy/55 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   WHY [BUSINESS NAME]
───────────────────────────────────────────── */
const WHY_ITEMS = [
  {
    icon: Heart,
    title: "Lorem Ipsum Dolor",
    desc: "Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod.",
  },
  {
    icon: MapPin,
    title: "Amet Consectetur",
    desc: "Maecenas sed diam eget risus varius blandit sit amet non magna. Integer posuere erat a ante.",
  },
  {
    icon: GitBranch,
    title: "Praesent Commodo",
    desc: "Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod.",
  },
  {
    icon: Wrench,
    title: "Vivamus Sagittis",
    desc: "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Aenean lacinia bibendum.",
  },
  {
    icon: Scale,
    title: "Nullam Quis Risus",
    desc: "Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.",
  },
  {
    icon: Compass,
    title: "Aenean Lacinia",
    desc: "Nullam quis risus eget urna mollis ornare vel eu leo. Morbi leo risus porta ac consectetur.",
  },
];

function WhyUs() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-why-card]", { y: 24, duration: 0.8, stagger: 0.08 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32 bg-navy relative overflow-hidden">
      {/* City skyline bg — subtle atmospheric layer */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={AUSTIN.skylineDusk}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-bottom opacity-10"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-navy/60" />
      </div>

      <div className="text-center max-w-2xl mx-auto mb-14 relative">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white/60 text-xs font-medium mb-5 tracking-wide">
          Our Approach
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-white tracking-tight leading-tight">
          Why{" "}
          <span className="font-drama italic text-brand-400 text-4xl md:text-5xl">
            {BUSINESS.name}
          </span>
        </h2>
        <p className="mt-4 text-white/50 text-base leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 relative">
        {WHY_ITEMS.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            data-why-card
            className="rounded-3xl p-7 border border-white/8 bg-white/4 hover:bg-white/7 transition-colors duration-300"
          >
            <div className="w-10 h-10 rounded-2xl bg-brand-500/15 flex items-center justify-center mb-4">
              <Icon size={18} className="text-brand-400" />
            </div>
            <h3 className="font-heading font-bold text-base text-white mb-2">
              {title}
            </h3>
            <p className="text-white/50 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   MEET THE TEAM — 4 team members with links to bios
───────────────────────────────────────────── */
const COACHES = [
  { id: "member-one",   name: "Team Member One",   role: "Role / Title",  photo: TEAM.charles1 },
  { id: "member-two",   name: "Team Member Two",   role: "Role / Title",  photo: TEAM.justin1 },
  { id: "member-three", name: "Team Member Three", role: "Role / Title",  photo: TEAM.matthew1 },
  { id: "member-four",  name: "Team Member Four",  role: "Role / Title",  photo: TEAM.damian1 },
];

function Team() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-team-card]", { y: 30, duration: 0.8, stagger: 0.12 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32 bg-surface-100">
      <div className="text-center max-w-xl mx-auto mb-14">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
          Meet the Team
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight">
          A{" "}
          <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">dedicated</span>{" "}
          team, lorem ipsum dolor sit.
        </h2>
        <p className="mt-4 text-navy/55 text-base leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas
          faucibus mollis interdum. Nullam id dolor id nibh ultricies vehicula.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {COACHES.map((coach) => (
          <Link
            key={coach.id}
            to={`/about#${coach.id}`}
            data-team-card
            className="group block"
          >
            <div className="relative rounded-3xl overflow-hidden aspect-[3/4] shadow-md group-hover:shadow-xl transition-shadow duration-300">
              <img
                src={coach.photo}
                alt={coach.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/70 via-navy/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h3 className="font-heading font-bold text-lg text-white leading-tight">
                  {coach.name}
                </h3>
                <p className="text-white/60 text-sm mt-0.5">{coach.role}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="text-center mt-10">
        <Link
          to="/about#member-one"
          className="inline-flex items-center gap-2 text-brand-500 font-semibold text-sm hover:gap-3 transition-all duration-300"
        >
          Read Full Bios
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   CTA — expanding scroll effect.
   A fixed full-viewport background fades in
   while the card scales up and goes transparent,
   creating the illusion of expansion.
   Swap the solid black bg for a full-bleed
   <img> inside the fixed background when ready.
───────────────────────────────────────────── */
function CTA() {
  const sectionRef = useRef(null);
  const cardRef = useRef(null);
  const bgRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    const card = cardRef.current;
    const bg = bgRef.current;
    if (!section || !card || !bg) return;

    const nextSection = section.nextElementSibling;
    let active = false;
    let ticking = false;

    const isNextSectionOverlapping = () => {
      if (!nextSection) return false;
      return nextSection.getBoundingClientRect().top < window.innerHeight * 0.6;
    };

    const update = () => {
      const rect = card.getBoundingClientRect();
      const vh = window.innerHeight;
      const topPct = rect.top / vh;
      const bottomPct = rect.bottom / vh;

      if (!active) {
        const inRange = topPct < 0.66 && bottomPct > 0.33;
        if (inRange && !isNextSectionOverlapping()) {
          active = true;
          bg.style.opacity = "1";
          card.style.transform = "scale(1.15)";
          card.style.borderRadius = "0";
          card.style.backgroundColor = "transparent";
        }
      } else {
        let shouldExit = false;
        if (isNextSectionOverlapping()) shouldExit = true;
        if (topPct > 0.75) shouldExit = true;
        if (shouldExit) {
          active = false;
          bg.style.opacity = "0";
          card.style.transform = "scale(1)";
          card.style.borderRadius = "";
          card.style.backgroundColor = "";
        }
      }

      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const ease = "cubic-bezier(0.25, 0.8, 0.25, 1)";

  return (
    <>
      {/* Fixed full-viewport background — fades in when CTA is in view */}
      <div
        ref={bgRef}
        className="fixed inset-0 z-40 pointer-events-none"
        style={{ opacity: 0, transition: `opacity 0.8s ${ease}` }}
      >
        <img
          src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1920&h=1080&q=80"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      <section ref={sectionRef} className="section-pad py-24 md:py-32 relative z-[41]">
        <div
          ref={cardRef}
          className="bg-black rounded-4xl md:rounded-5xl p-10 md:p-16 min-h-[500px] md:min-h-[600px] flex items-center justify-center text-center relative overflow-hidden"
          style={{
            transition: `transform 0.8s ${ease}, background-color 0.8s ${ease}, border-radius 0.8s ${ease}`,
          }}
        >
          <NoiseOverlay />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white/70 text-xs font-medium mb-6 tracking-wide">
              Take the Next Step
            </div>
            <h2 className="font-heading font-bold text-3xl md:text-5xl text-white tracking-tight leading-tight max-w-2xl mx-auto">
              Lorem ipsum dolor sit{" "}
              <span className="font-drama italic text-4xl md:text-6xl">amet?</span>
            </h2>
            <p className="mt-5 text-white/60 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              Praesent commodo cursus magna, vel scelerisque nisl consectetur et.
              Donec sed odio dui. Maecenas faucibus mollis interdum.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                to="/contact"
                className="px-8 py-3.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors duration-300 shadow-lg"
              >
                Get in Touch
              </Link>
              <Link
                to="/about"
                className="px-8 py-3.5 rounded-full border border-white/30 text-white font-medium text-sm hover:bg-white/10 transition-colors duration-300"
              >
                Learn About Us
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────────────────────────
   PAGE EXPORT
───────────────────────────────────────────── */
export function HomePage() {
  return (
    <>
      <Hero />
      <Mission />
      <Services />
      <WhoWeServe />
      <WhyUs />
      <Team />
      <CTA />
    </>
  );
}
