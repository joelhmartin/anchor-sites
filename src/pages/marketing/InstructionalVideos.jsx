import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Play } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const VIDEOS = [
  {
    id: "1169988766",
    title: "Tips on Scanning Difficult Cases",
    aspect: "50%", // slightly different aspect for this one
  },
  {
    id: "1169987842",
    title: "Delivery of OD-PMT and ON-P (PMT)",
  },
  {
    id: "1169985466",
    title: "Phonetic Bite",
  },
  {
    id: "1169985993",
    title: "Minimum Occlusal Space Requirements",
  },
  {
    id: "1169985879",
    title: "Phonetic Bite — Anterior",
  },
  {
    id: "1169986561",
    title: "How to Adjust Appliances",
  },
  {
    id: "1169981727",
    title: "Shirazi Hybrid",
  },
];

export function InstructionalVideosPage() {
  const sectionRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-vid-hero]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.2,
      });
      gsap.from("[data-vid-card]", {
        y: 30,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-vid-grid]",
          start: "top 80%",
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={sectionRef}>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-navy via-brand-900 to-surface-100 pt-32 pb-28">
        <div className="section-pad text-center max-w-3xl mx-auto">
          <span
            data-vid-hero
            className="font-mono text-xs text-white/30 uppercase tracking-widest"
          >
            Resources
          </span>
          <h1
            data-vid-hero
            className="mt-4 font-heading font-bold text-3xl md:text-5xl text-white tracking-tight"
          >
            Instructional Videos
          </h1>
          <p
            data-vid-hero
            className="mt-4 text-white/40 text-sm md:text-base max-w-lg mx-auto leading-relaxed"
          >
            Training and technique videos to help you get the best results with
            Diamond Orthotic Laboratory products.
          </p>
        </div>
      </section>

      {/* Video grid */}
      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div
          data-vid-grid
          className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {VIDEOS.map((video) => (
            <div
              key={video.id}
              data-vid-card
              className="bg-white card-radius overflow-hidden border border-surface-300/50 shadow-sm hover:shadow-lg transition-shadow duration-300"
            >
              <div
                className="relative w-full"
                style={{ paddingTop: video.aspect || "56.25%" }}
              >
                <iframe
                  src={`https://player.vimeo.com/video/${video.id}?title=0&byline=0&portrait=0&badge=0&autopause=0&player_id=0&app_id=58479`}
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 w-full h-full"
                  style={{ border: "none" }}
                  title={video.title}
                  loading="lazy"
                />
              </div>
              <div className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center flex-shrink-0">
                  <Play size={14} className="text-brand-500 ml-0.5" />
                </div>
                <h3 className="font-heading font-semibold text-sm text-navy tracking-tight">
                  {video.title}
                </h3>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
