import { Link } from "react-router-dom";
import { ArrowUpRight, Phone, Mail } from "lucide-react";
import { SITE, BUSINESS, LOGOS, CONTENT, SERVICES_NAV } from "../../config/site.js";

const FOOTER_NAV = {
  Services: SERVICES_NAV,
  Company: [
    { label: "About Us",                  to: "/about" },
    { label: CONTENT.events.label,        to: CONTENT.events.listPath },
    { label: CONTENT.blog.label,          to: CONTENT.blog.listPath },
    { label: "Contact",                   to: "/contact" },
  ],
};

export function Footer() {
  return (
    <footer className="relative bg-navy rounded-t-[3rem] md:rounded-t-[4rem] mt-24">
      <div className="section-pad pt-16 pb-8 md:pt-24 md:pb-10">
        {/* Top section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-8 pb-12 border-b border-white/10">
          {/* Brand block */}
          <div className="md:col-span-5">
            <img
              src={LOGOS.horizontalWhite}
              alt={BUSINESS.name}
              className="h-10 w-auto mb-5"
            />
            <p className="text-white/50 text-sm leading-relaxed max-w-xs">
              {BUSINESS.description}
            </p>

            {/* Contact */}
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={SITE.phoneHref}
                className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors"
              >
                <Phone size={13} />
                <span>{SITE.phone}</span>
              </a>
              <a
                href={SITE.emailHref}
                className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors"
              >
                <Mail size={13} />
                <span>{SITE.email}</span>
              </a>
            </div>

            {/* Social links */}
            <div className="mt-6 flex items-center gap-3">
              {SITE.socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-white hover:bg-brand-500/20 hover:border-brand-500/30 transition-all duration-300"
                  aria-label={s.label}
                >
                  <s.icon size={14} />
                </a>
              ))}
            </div>
          </div>

          {/* Nav columns */}
          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-8">
            {Object.entries(FOOTER_NAV).map(([title, links]) => (
              <div key={title}>
                <h4 className="font-heading font-semibold text-white/30 text-xs uppercase tracking-widest mb-4">
                  {title}
                </h4>
                <ul className="space-y-2.5">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="group flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors duration-300"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8">
          <p className="text-white/30 text-xs">
            &copy; {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-white/30 text-xs">
            <span className="hover:text-white/60 transition-colors cursor-pointer">
              Privacy Policy
            </span>
            <span className="hover:text-white/60 transition-colors cursor-pointer">
              Terms of Service
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
