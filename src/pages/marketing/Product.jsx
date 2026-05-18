import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Shield,
  Zap,
  Layers,
  Box,
} from "lucide-react";
import { ModelViewer } from "../../components/ModelViewer";

gsap.registerPlugin(ScrollTrigger);

/* ─── PRODUCT DATA ─── */
const PRODUCTS = {
  ddsoAnt: {
    name: "DDSO",
    fullName: "Diamond Digital Sleep Orthotic — Anterior",
    tagline: "FDA-cleared anterior contact design for precise mandibular advancement without posterior occlusal loading.",
    category: "Sleep Appliance",
    categoryColor: "text-accent-500",
    categoryBg: "bg-accent-500/10",
    images: [
      { src: "/images/ddso-ant-overview.webp",  label: "DDSO Anterior — Overview" },
      { src: "/images/ddso-ant-front.webp",     label: "DDSO Anterior — Front View" },
      { src: "/images/ddso-ant-hooks.webp",     label: "DDSO Anterior — Nylon Band Hooks" },
      { src: "/images/ddso-ant-angle.webp",     label: "DDSO Anterior — Angle View" },
      { src: "/images/ddso-ant-pair.webp",      label: "DDSO Anterior — Upper & Lower" },
      {
        is3D: true,
        objPath: "/models/DDSO_Anterior_contact.obj",
        mtlPath: "/models/DDSO_Anterior_contact.mtl",
        label: "DDSO Anterior — 3D View",
      },
    ],
    specs: [
      { label: "FDA Status",    value: "510(k) Cleared" },
      { label: "Design",        value: "Anterior Contact Only" },
      { label: "Material",      value: "Biocompatible Nylon PA12" },
      { label: "Fabrication",   value: "3D Printed (SLS)" },
      { label: "Turnaround",    value: "5–7 Business Days" },
      { label: "Retention",     value: "Nylon Band System" },
    ],
  },
  ddsoPost: {
    name: "DDSO",
    fullName: "Diamond Digital Sleep Orthotic — Posterior",
    tagline: "Full-arch posterior coverage with integrated nylon band titration system for progressive mandibular advancement.",
    category: "Sleep Appliance",
    categoryColor: "text-accent-500",
    categoryBg: "bg-accent-500/10",
    images: [
      { src: "/images/ddso-post-overview.webp",  label: "DDSO Posterior — Overview" },
      { src: "/images/ddso-post-iso.webp",        label: "DDSO Posterior — Isometric" },
      { src: "/images/ddso-post-stacked.webp",    label: "DDSO Posterior — Stacked" },
      { src: "/images/ddso-post-interior.webp",   label: "DDSO Posterior — Interior" },
      { src: "/images/ddso-blue-bands.webp",      label: "DDSO Posterior — Blue Bands" },
      {
        is3D: true,
        objPath: "/models/DDSO_BANDS_POSTERIOR.obj",
        mtlPath: "/models/DDSO_BANDS_POSTERIOR.mtl",
        label: "DDSO Posterior — 3D View",
      },
    ],
    specs: [
      { label: "FDA Status",    value: "510(k) Cleared" },
      { label: "Design",        value: "Full-Arch Posterior" },
      { label: "Material",      value: "Biocompatible Nylon PA12" },
      { label: "Fabrication",   value: "3D Printed (SLS)" },
      { label: "Turnaround",    value: "5–7 Business Days" },
      { label: "Titration",     value: "Adjustable Band System" },
    ],
  },
  ond: {
    name: "OND",
    fullName: "Olmos Neuromuscular Device",
    tagline: "Precision TMJ orthotic combining Nylon and Trutaine materials for optimal neuromuscular repositioning.",
    category: "TMD Orthotic",
    categoryColor: "text-brand-500",
    categoryBg: "bg-brand-500/10",
    images: [
      { src: "/images/ond-overview.webp",   label: "OND — Overview" },
      { src: "/images/ond-nylon.webp",      label: "OND — Nylon" },
      { src: "/images/ond-trutaine.webp",   label: "OND — Trutaine" },
      { src: "/images/ond-front.webp",      label: "OND — Front View" },
      { src: "/images/ond-bands.webp",      label: "OND — With Bands" },
      {
        is3D: true,
        objPath: "/models/OND_COMBINED.obj",
        mtlPath: "/models/OND_COMBINED.mtl",
        label: "OND — 3D View",
      },
    ],
    specs: [
      { label: "Protocol",      value: "Olmos Series Certified" },
      { label: "Materials",     value: "Nylon / Trutaine" },
      { label: "Fabrication",   value: "CAD/CAM + 3D Print" },
      { label: "Turnaround",    value: "5–7 Business Days" },
      { label: "Articulation",  value: "Digital Bite Registration" },
      { label: "Variants",      value: "OND / ONR" },
    ],
  },
  onp: {
    name: "ONP",
    fullName: "Olmos Neuromuscular Positioner — Trutaine",
    tagline: "Precision TMJ orthotic in Trutaine material, designed around the Olmos clinical protocol for optimal joint decompression.",
    category: "TMD Orthotic",
    categoryColor: "text-brand-500",
    categoryBg: "bg-brand-500/10",
    images: [
      { src: "/images/onp-front.webp",        label: "ONP — Front View" },
      { src: "/images/onp-nylon.webp",        label: "ONP — Nylon" },
      { src: "/images/onp-nylon4.webp",       label: "ONP — Nylon Detail" },
      { src: "/images/onp-bioflex-new.webp",  label: "ONP — Bioflex" },
      { src: "/images/onp-model.webp",        label: "ONP — On Model" },
      {
        is3D: true,
        objPath: "/models/ONP-Trutaine.obj",
        mtlPath: "/models/ONP-Trutaine.mtl",
        label: "ONP — 3D View",
      },
    ],
    specs: [
      { label: "Protocol",      value: "Olmos Series Certified" },
      { label: "Materials",     value: "Nylon / Bioflex / Trutaine" },
      { label: "Fabrication",   value: "CAD/CAM + 3D Print" },
      { label: "Turnaround",    value: "5–7 Business Days" },
      { label: "Articulation",  value: "Digital Bite Registration" },
      { label: "Variants",      value: "ONP / OND / ONR" },
    ],
  },
};

/* ─── PRODUCT VIEWER ─── */
function ProductViewer({ product }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const mainRef = useRef(null);

  const handleThumbClick = (idx) => {
    if (idx === activeIdx) return;
    const currentIs3D = product.images[activeIdx].is3D;
    const nextIs3D = product.images[idx].is3D;
    // Skip GSAP fade when switching to/from 3D (canvas mounts itself)
    if (currentIs3D || nextIs3D || !mainRef.current) {
      setActiveIdx(idx);
      return;
    }
    gsap.to(mainRef.current, {
      opacity: 0,
      duration: 0.2,
      onComplete: () => {
        setActiveIdx(idx);
        gsap.to(mainRef.current, { opacity: 1, duration: 0.3 });
      },
    });
  };

  const activeItem = product.images[activeIdx];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main display */}
      <div className="lg:col-span-8">
        <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden bg-surface-100 border border-surface-300/50">
          {activeItem.is3D ? (
            <ModelViewer
              objPath={activeItem.objPath}
              mtlPath={activeItem.mtlPath}
              className="w-full h-full"
            />
          ) : (
            <img
              ref={mainRef}
              src={activeItem.src}
              alt={activeItem.label}
              className="w-full h-full object-contain p-8"
            />
          )}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${product.categoryBg} ${product.categoryColor}`}
            >
              {product.category}
            </span>
            {activeItem.is3D && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-navy/80 text-white flex items-center gap-1">
                <Box size={10} />
                Interactive 3D
              </span>
            )}
          </div>
          {activeItem.is3D && (
            <div className="absolute bottom-4 right-4 text-[10px] font-mono text-white/30 pointer-events-none">
              drag to rotate · scroll to zoom
            </div>
          )}
        </div>
        {/* Thumbnails */}
        <div className="mt-4 flex gap-2 overflow-x-auto scrollbar-hide pb-2">
          {product.images.map((img, i) => (
            <button
              key={i}
              onClick={() => handleThumbClick(i)}
              className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden border-2 transition-all duration-300 ${
                i === activeIdx
                  ? "border-brand-500 ring-2 ring-brand-500/20"
                  : "border-surface-300/50 hover:border-surface-400"
              }`}
            >
              {img.is3D ? (
                <div className="w-full h-full bg-navy flex flex-col items-center justify-center gap-0.5">
                  <Box size={16} className="text-brand-400" />
                  <span className="text-[9px] font-mono text-white/50 leading-none">3D</span>
                </div>
              ) : (
                <img
                  src={img.src}
                  alt={img.label}
                  className="w-full h-full object-contain bg-surface-50 p-1"
                  loading="lazy"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="lg:col-span-4">
        <h2 className="font-heading font-bold text-3xl md:text-4xl tracking-tight">
          {product.name}
          <span className="font-drama italic text-brand-500">®</span>
        </h2>
        <p className="mt-1 font-heading text-sm text-navy/50">
          {product.fullName}
        </p>
        <p className="mt-4 text-navy/60 text-sm leading-relaxed">
          {product.tagline}
        </p>

        {/* Specs grid */}
        <div className="mt-6 space-y-3">
          {product.specs.map((spec, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-surface-300/30"
            >
              <span className="text-xs font-mono text-navy/40 uppercase">
                {spec.label}
              </span>
              <span className="text-sm font-medium text-navy/80">
                {spec.value}
              </span>
            </div>
          ))}
        </div>

        <Link
          to="/contact"
          className="btn-magnetic group mt-8 w-full px-6 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm inline-flex justify-center"
        >
          <span className="btn-bg bg-accent-600 rounded-full" />
          <span className="relative z-10 flex items-center gap-2">
            Request Information
            <ArrowRight
              size={16}
              className="group-hover:translate-x-1 transition-transform"
            />
          </span>
        </Link>
      </div>
    </div>
  );
}

/* ─── FEATURE HIGHLIGHTS ─── */
function FeatureHighlights() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-highlight]", {
        y: 40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const highlights = [
    {
      icon: Shield,
      label: "Olmos-Method Certified",
      desc: "Every appliance follows the exact clinical parameters defined by Dr. Steven Olmos.",
    },
    {
      icon: Zap,
      label: "Digital-First Workflow",
      desc: "From intraoral scan to 3D print — no analog steps, no cumulative error.",
    },
    {
      icon: Layers,
      label: "Multiple Materials",
      desc: "Nylon PA12, Bioflex, Trutaine — each case matched to the optimal material.",
    },
  ];

  return (
    <section ref={ref} className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {highlights.map((h, i) => (
          <div
            key={i}
            data-highlight
            className="flex items-start gap-4 p-6 bg-white card-radius border border-surface-300/50"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
              <h.icon size={18} className="text-brand-500" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-sm">{h.label}</h3>
              <p className="mt-1 text-navy/50 text-sm leading-relaxed">
                {h.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── LIFESTYLE SLIDER ─── */
function LifestyleSlider() {
  const [current, setCurrent] = useState(0);

  const slides = [
    { src: "/images/dorsal1.webp", label: "Dorsal Orthotic — Clinical View" },
    { src: "/images/dorsal2.webp", label: "Dorsal Orthotic — Model" },
    { src: "/images/od-pmt-dark1.webp", label: "OD PMT — Studio" },
    { src: "/images/od-pmt-dark2.webp", label: "OD PMT — Detail" },
    { src: "/images/onp-bioflex2.webp", label: "ONP Bioflex — Studio" },
    { src: "/images/ddso-blue-bands.webp", label: "DDSO — Blue Band Configuration" },
  ];

  const slide = (dir) => {
    setCurrent((prev) => {
      const next = prev + dir;
      if (next < 0) return slides.length - 1;
      if (next >= slides.length) return 0;
      return next;
    });
  };

  useEffect(() => {
    const interval = setInterval(() => slide(1), 4500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative w-full overflow-hidden py-12 md:py-20 bg-navy">
      <div className="section-pad mb-6 flex items-center justify-between">
        <span className="font-mono text-xs text-white/40 uppercase tracking-widest">
          Product Gallery
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => slide(-1)}
            className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => slide(1)}
            className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Next"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((s, i) => (
            <div key={i} className="w-full flex-shrink-0 px-4 md:px-8">
              <div className="relative w-full aspect-[16/9] md:aspect-[21/9] rounded-[2rem] overflow-hidden bg-navy-light">
                <img
                  src={s.src}
                  alt={s.label}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-navy/80 to-transparent">
                  <span className="text-white/80 text-sm font-medium">
                    {s.label}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 mt-6">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? "w-6 bg-brand-500" : "w-1.5 bg-white/20"
            }`}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

/* ─── PRODUCT HERO ─── */
function ProductHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-phero]", {
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
      className="relative h-[50dvh] min-h-[380px] flex items-end overflow-hidden"
    >
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1581093458791-9d42e3c9e8b0?auto=format&fit=crop&w=1920&q=80"
          alt="Precision 3D printing"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
      </div>
      <div className="relative z-10 section-pad pb-12 md:pb-16 max-w-3xl">
        <span data-phero className="font-mono text-xs text-white/40 uppercase tracking-widest">
          Our Products
        </span>
        <h1 data-phero className="mt-4 text-white">
          <span className="block font-heading font-bold text-3xl sm:text-4xl md:text-6xl tracking-tight leading-[0.95]">
            Precision appliances for
          </span>
          <span className="block font-drama italic text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.9] text-brand-500">
            every protocol.
          </span>
        </h1>
      </div>
    </section>
  );
}

/* ─── PRODUCT TABS ─── */
function ProductTabs() {
  const [activeProduct, setActiveProduct] = useState("ddsoAnt");
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-product-entry]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad pt-16 pb-16 md:pt-24 md:pb-24">
      <div className="max-w-6xl mx-auto">

        {/* Tabs */}
        <div data-product-entry className="flex flex-wrap items-center gap-2 mb-8">
          {[
            { key: "ddsoAnt",  label: "DDSO — Anterior",  sub: "Sleep Appliance" },
            { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
            { key: "ond",      label: "OND",              sub: "TMD Orthotic" },
            { key: "onp",      label: "ONP",              sub: "TMD Orthotic" },
          ].map(({ key, label, sub }) => (
            <button
              key={key}
              onClick={() => setActiveProduct(key)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                activeProduct === key
                  ? "bg-brand-500 text-white"
                  : "bg-surface-200/60 text-navy/50 hover:text-navy hover:bg-surface-300/60"
              }`}
            >
              {label}
              <span className="hidden sm:inline text-xs opacity-60"> · {sub}</span>
            </button>
          ))}
        </div>

        {/* Active product */}
        <div data-product-entry>
          <ProductViewer
            key={activeProduct}
            product={PRODUCTS[activeProduct]}
          />
        </div>
      </div>
    </section>
  );
}

/* ─── CTA BAR ─── */
function ProductCTA() {
  return (
    <section className="section-pad py-16 md:py-24">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="font-heading font-bold text-2xl md:text-4xl tracking-tight">
          Questions about our products?
        </h2>
        <p className="mt-4 text-navy/50 text-base max-w-lg mx-auto">
          Our team is ready to discuss which appliance and material options are
          the best fit for your patients.
        </p>
        <Link
          to="/contact"
          className="btn-magnetic group mt-8 inline-flex px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
        >
          <span className="btn-bg bg-accent-600 rounded-full" />
          <span className="relative z-10 flex items-center gap-2">
            Contact Our Lab
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
export function ProductPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <ProductHero />
      <ProductTabs />
      <FeatureHighlights />
      <LifestyleSlider />
      <ProductCTA />
    </>
  );
}
