import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import gsap from "gsap";
import LogoFull from "../../images/logoFull.jsx";
import { SITE, CONTENT, SERVICES_NAV } from "../../config/site.js";

const NAV_LINKS = [
  { label: "About", to: "/about" },
  {
    label: "Services",
    children: SERVICES_NAV,
  },
  { label: CONTENT.events.label, to: CONTENT.events.listPath },
  { label: CONTENT.blog.label,   to: CONTENT.blog.listPath },
  { label: "Contact", to: "/contact" },
];

/* ─── Animated hamburger icon (3 bars → X) ─── */
function HamburgerIcon({ open, scrolled }) {
  const color = open
    ? "bg-white"
    : scrolled
    ? "bg-navy"
    : "bg-white";

  return (
    <div className="relative w-5 h-4 flex flex-col justify-between">
      <span
        className={`block h-[2px] w-full rounded-full transition-all duration-300 origin-center ${color} ${
          open ? "translate-y-[7px] rotate-45" : ""
        }`}
      />
      <span
        className={`block h-[2px] w-full rounded-full transition-all duration-300 ${color} ${
          open ? "opacity-0 scale-x-0" : "opacity-100"
        }`}
      />
      <span
        className={`block h-[2px] w-full rounded-full transition-all duration-300 origin-center ${color} ${
          open ? "-translate-y-[7px] -rotate-45" : ""
        }`}
      />
    </div>
  );
}

/* ─── Desktop nav item (with optional dropdown) ─── */
function NavItem({ link, scrolled, isActive }) {
  const [open, setOpen] = useState(false);
  const timeout = useRef(null);

  const enter = () => { clearTimeout(timeout.current); setOpen(true); };
  const leave = () => { timeout.current = setTimeout(() => setOpen(false), 150); };

  const baseClass = `px-3 py-1.5 rounded-full text-[13px] font-medium transition-all duration-300 whitespace-nowrap flex items-center gap-1`;
  const colorClass = isActive
    ? scrolled
      ? "bg-brand-500/10 text-brand-500"
      : "bg-white/15 text-white"
    : scrolled
    ? "text-navy/70 hover:text-navy hover:bg-surface-200/60"
    : "text-white/70 hover:text-white hover:bg-white/10";

  if (!link.children) {
    return (
      <Link to={link.to} className={`${baseClass} ${colorClass}`}>
        {link.label}
      </Link>
    );
  }

  return (
    <div className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button className={`${baseClass} ${colorClass}`}>
        {link.label}
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 pt-2 z-50">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-surface-300/50 shadow-xl shadow-navy/10 py-2 min-w-[260px] overflow-hidden">
            {link.children.map((child) => (
              <Link
                key={child.label}
                to={child.to}
                className="block px-4 py-2.5 text-sm text-navy/70 hover:text-brand-500 hover:bg-brand-50 transition-colors"
                onClick={() => setOpen(false)}
              >
                {child.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Full-screen mobile overlay ─── */
function MobileOverlay({ open, onNavigate, isActive }) {
  const overlayRef = useRef(null);
  const linksRef = useRef(null);
  const [expandedGroup, setExpandedGroup] = useState(null);

  useEffect(() => {
    if (!overlayRef.current) return;

    if (open) {
      // Lock body scroll
      document.body.style.overflow = "hidden";

      gsap.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.35, ease: "power3.out" }
      );

      // Stagger links in
      const items = linksRef.current?.querySelectorAll("[data-mobile-link]");
      if (items?.length) {
        gsap.fromTo(
          items,
          { opacity: 0, x: -30 },
          {
            opacity: 1,
            x: 0,
            duration: 0.5,
            stagger: 0.06,
            ease: "power3.out",
            delay: 0.15,
          }
        );
      }
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const handleNavigate = () => {
    setExpandedGroup(null);
    onNavigate();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 bg-navy/95 backdrop-blur-lg flex flex-col"
    >
      {/* Spacer for navbar */}
      <div className="h-24" />

      {/* Scrollable nav links */}
      <div ref={linksRef} className="flex-1 overflow-y-auto px-8 pt-4 pb-4">
        {NAV_LINKS.map((link) => {
          if (!link.children) {
            return (
              <Link
                key={link.label}
                to={link.to}
                data-mobile-link
                onClick={handleNavigate}
                className={`block py-4 border-b border-white/10 text-2xl font-heading font-bold tracking-tight transition-colors ${
                  isActive(link) ? "text-brand-400" : "text-white hover:text-brand-300"
                }`}
              >
                {link.label}
              </Link>
            );
          }

          const isExpanded = expandedGroup === link.label;

          return (
            <div key={link.label} data-mobile-link>
              <button
                onClick={() => setExpandedGroup(isExpanded ? null : link.label)}
                className="w-full flex items-center justify-between py-4 border-b border-white/10 text-2xl font-heading font-bold tracking-tight text-white hover:text-brand-300 transition-colors"
              >
                {link.label}
                <ChevronDown
                  size={20}
                  className={`text-white/40 transition-transform duration-300 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="pl-4 py-2 space-y-1">
                  {link.children.map((child) => (
                    <Link
                      key={child.label}
                      to={child.to}
                      onClick={handleNavigate}
                      className="block py-2.5 text-base text-white/50 hover:text-brand-400 transition-colors"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky bottom — CTA + socials */}
      <div className="flex-shrink-0 px-8 pb-8 pt-4 border-t border-white/10 bg-navy/95">
        <Link
          to="/contact"
          data-mobile-link
          onClick={handleNavigate}
          className="block w-full text-center px-8 py-4 rounded-full bg-brand-500 text-white font-semibold text-lg hover:bg-brand-600 transition-colors"
        >
          Get Started
        </Link>
        <div data-mobile-link className="mt-4 flex items-center justify-center gap-4">
          {SITE.socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/20 transition-all"
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

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (link) => {
    if (link.to && location.pathname === link.to) return true;
    if (link.children) return link.children.some((c) => location.pathname === c.to);
    return false;
  };

  return (
    <>
      {/* Social bar — fades out on scroll */}
      <div
        className={`fixed top-3 right-6 z-50 flex items-center gap-3 transition-all duration-500 ${
          scrolled || mobileOpen
            ? "opacity-0 -translate-y-full pointer-events-none"
            : "opacity-100"
        }`}
      >
        {SITE.socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white transition-colors duration-300"
            aria-label={s.label}
          >
            <s.icon size={14} />
          </a>
        ))}
      </div>

      {/* Full-screen mobile overlay (behind nav bar) */}
      <MobileOverlay
        open={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        isActive={isActive}
      />

      <nav
        ref={navRef}
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out
          ${
            mobileOpen
              ? "top-4 bg-transparent border border-transparent"
              : scrolled
              ? "top-4 bg-white/80 backdrop-blur-xl border border-surface-300/50 shadow-lg shadow-navy/5"
              : "top-8 bg-transparent border border-transparent"
          }
          rounded-full px-3 py-2 md:px-5 md:py-2.5 max-w-6xl w-[calc(100%-2rem)]`}
      >
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center hover-lift flex-shrink-0">
            <LogoFull
              className="h-10 w-auto"
              dark={scrolled && !mobileOpen}
            />
          </Link>

          {/* Desktop links */}
          <div className="hidden lg:flex items-center gap-0.5">
            {NAV_LINKS.map((link) => (
              <NavItem
                key={link.label}
                link={link}
                scrolled={scrolled}
                isActive={isActive(link)}
              />
            ))}
          </div>

          {/* CTA + Mobile toggle */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to="/contact"
              className={`hidden lg:inline-flex px-5 py-2 rounded-full text-[13px] font-semibold transition-all duration-300 ${
                scrolled
                  ? "bg-brand-500 text-white hover:bg-brand-600 shadow-sm"
                  : "bg-white text-navy hover:bg-brand-50"
              }`}
            >
              Get Started
            </Link>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-full transition-colors duration-300"
              aria-label="Toggle menu"
            >
              <HamburgerIcon open={mobileOpen} scrolled={scrolled} />
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
