import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  Heart,
  Users,
  Shield,
  Compass,
} from "lucide-react";
import { AUSTIN, TEAM } from "../../config/images.js";
import { BUSINESS } from "../../config/site.js";

/* ── Scroll reveal helper (IntersectionObserver, no ScrollTrigger) ── */
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

/* ─── NOISE OVERLAY ─── */
function NoiseOverlay() {
  return (
    <svg className="noise-overlay" width="100%" height="100%">
      <filter id="noise-about">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.75"
          numOctaves="4"
          stitchTiles="stitch"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#noise-about)" />
    </svg>
  );
}

/* ─── HERO ─── */
function AboutHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-about-hero]", {
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
      className="relative h-[70dvh] min-h-[500px] flex items-end overflow-hidden"
    >
      <div className="absolute inset-0">
        <img
          src={AUSTIN.ladyBirdSunset}
          alt={`${BUSINESS.location} skyline`}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
        <NoiseOverlay />
      </div>

      <div className="relative z-10 section-pad pb-16 md:pb-24 max-w-4xl">
        <span
          data-about-hero
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-white/60 text-xs font-mono tracking-wider"
        >
          {`Based in ${BUSINESS.location}`}
        </span>
        <h1 data-about-hero className="mt-6">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95] text-white">
            Lorem ipsum dolor,
          </span>
          <span className="block font-drama italic text-5xl sm:text-6xl md:text-8xl tracking-tight leading-[0.9] text-brand-400">
            sit amet consectetur.
          </span>
        </h1>
        <p
          data-about-hero
          className="mt-6 text-white/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent
          commodo cursus magna, vel scelerisque nisl consectetur et. Donec
          sed odio dui.
        </p>
      </div>
    </section>
  );
}

/* ─── OUR STORY ─── */
function OurStory() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-story]", { y: 30, duration: 0.8, stagger: 0.1 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        {/* Photo */}
        <div data-story>
          <div className="relative rounded-3xl overflow-hidden aspect-[4/5] shadow-2xl shadow-navy/10">
            <img
              src={TEAM.charlesJustin1}
              alt={`${BUSINESS.name} founders`}
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>

        {/* Text */}
        <div>
          <div
            data-story
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide"
          >
            Our Story
          </div>

          <h2
            data-story
            className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight mb-6"
          >
            Lorem ipsum dolor{" "}
            <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">
              sit amet
            </span>
            —consectetur adipiscing elit.
          </h2>

          <p data-story className="text-navy/60 text-base leading-relaxed mb-5">
            Maecenas sed diam eget risus varius blandit sit amet non magna.
            Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id
            ligula porta felis euismod semper. Cras mattis consectetur purus
            sit amet fermentum.
          </p>
          <p data-story className="text-navy/60 text-base leading-relaxed mb-5">
            Nullam quis risus eget urna mollis ornare vel eu leo. Integer
            posuere erat a ante venenatis dapibus posuere velit aliquet.
            Praesent commodo cursus magna, vel scelerisque nisl consectetur et.
          </p>
          <p data-story className="text-navy/60 text-base leading-relaxed">
            Aenean lacinia bibendum nulla sed consectetur. Fusce dapibus,
            tellus ac cursus commodo, tortor mauris condimentum nibh, ut
            fermentum massa justo sit amet risus.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── MISSION ─── */
function Mission() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-mission]", { y: 30, duration: 0.8, stagger: 0.1 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32 bg-surface-100">
      <div className="max-w-4xl mx-auto text-center">
        <div
          data-mission
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-6 tracking-wide"
        >
          Our Mission
        </div>
        <blockquote data-mission>
          <p className="font-drama italic text-3xl sm:text-4xl md:text-5xl text-navy leading-[1.15] tracking-tight">
            Lorem ipsum dolor sit amet,{" "}
            <span className="text-brand-500">
              consectetur adipiscing elit, sed do eiusmod.
            </span>
          </p>
        </blockquote>
        <p
          data-mission
          className="mt-8 text-navy/55 text-base md:text-lg max-w-2xl mx-auto leading-relaxed"
        >
          Maecenas sed diam eget risus varius blandit sit amet non magna.
          Integer posuere erat a ante venenatis dapibus posuere velit aliquet.
          Cras mattis consectetur purus sit amet fermentum. Nullam quis risus
          eget urna mollis ornare vel eu leo.
        </p>
        <div
          data-mission
          className="mt-8 flex items-center justify-center gap-3 text-navy/30 text-sm"
        >
          <div className="h-px w-12 bg-navy/10" />
          <span className="font-mono text-xs">
            Lorem · Ipsum · Dolor · Amet
          </span>
          <div className="h-px w-12 bg-navy/10" />
        </div>
      </div>
    </section>
  );
}

/* ─── PHILOSOPHY — dark section with city bg ─── */
function Philosophy() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-philo]", { y: 40, duration: 0.8, stagger: 0.12 });

  return (
    <section
      ref={ref}
      className="relative bg-navy overflow-hidden py-24 md:py-32"
    >
      {/* City skyline atmospheric bg */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={AUSTIN.skylineDusk}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-bottom opacity-10"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-navy/60" />
      </div>

      <div className="relative z-10 section-pad">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Content */}
          <div>
            <div
              data-philo
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white/60 text-xs font-medium mb-5 tracking-wide"
            >
              Our Philosophy
            </div>
            <h2
              data-philo
              className="font-heading font-bold text-3xl md:text-4xl text-white tracking-tight"
            >
              Lorem ipsum dolor,
              <br />
              <span className="font-drama italic text-brand-400 text-4xl md:text-5xl">
                sit amet consectetur.
              </span>
            </h2>
            <p
              data-philo
              className="mt-6 text-white/55 text-base leading-relaxed"
            >
              Praesent commodo cursus magna, vel scelerisque nisl consectetur
              et. Donec sed odio dui. Maecenas faucibus mollis interdum.
            </p>
            <p
              data-philo
              className="mt-4 text-white/55 text-base leading-relaxed"
            >
              Maecenas sed diam eget risus varius blandit sit amet non magna.
              Integer posuere erat a ante venenatis dapibus posuere velit aliquet.
            </p>
          </div>

          {/* Team photo */}
          <div data-philo className="flex justify-center lg:justify-end">
            <div className="relative rounded-3xl overflow-hidden aspect-[4/3] max-w-md w-full shadow-2xl">
              <img
                src={TEAM.goofin}
                alt={`${BUSINESS.name} team`}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── VALUES ─── */
function Values() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-value-card]", { y: 40, duration: 0.7, stagger: 0.12 });

  const values = [
    {
      icon: Heart,
      title: "Lorem Ipsum",
      desc: "Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper.",
    },
    {
      icon: Shield,
      title: "Dolor Sit Amet",
      desc: "Maecenas sed diam eget risus varius blandit sit amet non magna. Integer posuere erat a ante venenatis.",
    },
    {
      icon: Users,
      title: "Consectetur Elit",
      desc: "Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod semper.",
    },
    {
      icon: Compass,
      title: "Praesent Commodo",
      desc: "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Aenean lacinia bibendum.",
    },
  ];

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
            Our Values
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-4xl tracking-tight">
            What drives{" "}
            <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">
              everything
            </span>{" "}
            we do.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {values.map((v) => (
            <div
              key={v.title}
              data-value-card
              className="bg-white rounded-3xl p-7 border border-surface-200/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-2xl bg-brand-100 flex items-center justify-center mb-5">
                <v.icon size={18} className="text-brand-500" />
              </div>
              <h3 className="font-heading font-bold text-base mb-2">
                {v.title}
              </h3>
              <p className="text-navy/50 text-sm leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── TEAM BIOS ─── */
const COACHES = [
  {
    id: "member-one",
    name: "Team Member One",
    role: "Role / Title",
    photo: TEAM.charles1,
    bio: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas sed diam eget risus varius blandit sit amet non magna. Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.

Nullam quis risus eget urna mollis ornare vel eu leo. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Aenean eu leo quam. Pellentesque ornare sem lacinia quam venenatis vestibulum. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh.`,
    quote: `"Etiam porta sem malesuada magna mollis euismod. Cras mattis consectetur purus sit amet fermentum."`,
  },
  {
    id: "member-two",
    name: "Team Member Two",
    role: "Role / Title",
    photo: TEAM.justin1,
    bio: `Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Aenean lacinia bibendum nulla sed consectetur. Donec sed odio dui. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Nulla vitae elit libero, a pharetra augue.

Maecenas faucibus mollis interdum. Nullam id dolor id nibh ultricies vehicula ut id elit. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit.`,
    quote: `"Vestibulum id ligula porta felis euismod semper. Integer posuere erat a ante venenatis dapibus."`,
  },
  {
    id: "member-three",
    name: "Team Member Three",
    role: "Role / Title",
    photo: TEAM.matthew1,
    bio: `Cras mattis consectetur purus sit amet fermentum. Donec id elit non mi porta gravida at eget metus. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Nullam quis risus eget urna mollis ornare vel eu leo.`,
    quote: `"Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus."`,
  },
  {
    id: "member-four",
    name: "Team Member Four",
    role: "Role / Title",
    photo: TEAM.damian1,
    bio: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum. Nullam id dolor id nibh ultricies vehicula ut id elit. Donec ullamcorper nulla non metus auctor fringilla. Cras mattis consectetur purus sit amet fermentum. Vestibulum id ligula porta felis euismod semper.",
    quote: null,
  },
];

function TeamBios() {
  const ref = useRef(null);
  useScrollReveal(ref, "[data-bio-card]", { y: 40, duration: 0.8, stagger: 0.15 });

  return (
    <section ref={ref} className="section-pad py-24 md:py-32 bg-surface-100">
      <div className="text-center max-w-xl mx-auto mb-14">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-5 tracking-wide">
          Meet the Team
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight leading-tight">
          A{" "}
          <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">small team</span>
          {" "}lorem ipsum dolor sit.
        </h2>
      </div>

      <div className="space-y-16">
        {COACHES.map((coach, i) => (
          <div
            key={coach.id}
            id={coach.id}
            data-bio-card
            className="scroll-mt-32"
          >
            <div
              className={`grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-16 items-center ${
                i % 2 === 1 ? "lg:direction-rtl" : ""
              }`}
            >
              {/* Photo — 2 of 5 cols */}
              <div
                className={`lg:col-span-2 ${
                  i % 2 === 1 ? "lg:order-2" : "lg:order-1"
                }`}
              >
                <div className="relative rounded-3xl overflow-hidden aspect-[3/4] shadow-xl shadow-navy/10">
                  <img
                    src={coach.photo}
                    alt={coach.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              {/* Content — 3 of 5 cols */}
              <div
                className={`lg:col-span-3 ${
                  i % 2 === 1 ? "lg:order-1" : "lg:order-2"
                }`}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-4 tracking-wide">
                  {coach.role}
                </div>
                <h3 className="font-heading font-bold text-2xl md:text-3xl text-navy tracking-tight mb-5">
                  {coach.name}
                </h3>
                {coach.bio.split("\n\n").map((paragraph, pi) => (
                  <p
                    key={pi}
                    className="text-navy/60 text-base leading-relaxed mb-4 last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}
                {coach.quote && (
                  <blockquote className="mt-6 pl-5 border-l-3 border-brand-300 text-navy/50 italic text-base leading-relaxed">
                    {coach.quote}
                  </blockquote>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── CTA ─── */
function AboutCTA() {
  return (
    <section className="section-pad py-24 md:py-32">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="font-heading font-bold text-2xl md:text-4xl tracking-tight">
          Lorem ipsum dolor
          <span className="font-drama italic text-brand-500 text-3xl md:text-5xl"> sit amet?</span>
        </h2>
        <p className="mt-4 text-navy/50 text-base max-w-lg mx-auto leading-relaxed">
          Praesent commodo cursus magna, vel scelerisque nisl consectetur et.
          Donec sed odio dui. Maecenas faucibus mollis interdum.
        </p>
        <Link
          to="/contact"
          className="btn-magnetic group mt-8 inline-flex px-8 py-4 rounded-full bg-brand-500 text-white font-semibold"
        >
          <span className="btn-bg bg-brand-600 rounded-full" />
          <span className="relative z-10 flex items-center gap-2">
            Get in Touch
            <ArrowRight
              size={16}
              className="group-hover:translate-x-1 transition-transform"
            />
          </span>
        </Link>
      </div>
    </section>
  );
}

/* ─── PAGE EXPORT ─── */
// Also export COACHES so Home page can reference the same data
export { COACHES };

export function AboutPage() {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const timer = setTimeout(() => {
        const el = document.querySelector(hash);
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }, 100);
      return () => clearTimeout(timer);
    }
    window.scrollTo(0, 0);
  }, [hash]);


  return (
    <>
      <AboutHero />
      <OurStory />
      <Mission />
      <Philosophy />
      <Values />
      <TeamBios />
      <AboutCTA />
    </>
  );
}
