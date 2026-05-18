import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";

export function ComingSoonPage() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Derive a readable title from the URL path
  const pathTitle = location.pathname
    .split("/")
    .pop()
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-navy via-brand-900 to-surface-100 pt-32 pb-28">
        <div className="section-pad text-center max-w-2xl mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center mx-auto mb-6">
            <Clock size={24} className="text-white/50" />
          </div>
          <span className="font-mono text-xs text-white/30 uppercase tracking-widest">
            Coming Soon
          </span>
          <h1 className="mt-4 font-heading font-bold text-3xl md:text-5xl text-white tracking-tight">
            {pathTitle}
          </h1>
          <p className="mt-4 text-white/40 text-sm md:text-base max-w-md mx-auto leading-relaxed">
            We&apos;re putting the finishing touches on this page. Check back
            soon or contact us for more information.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div className="max-w-lg mx-auto text-center">
          <div className="bg-white card-radius p-10 border border-surface-300/50 shadow-xl shadow-navy/5">
            <p className="text-navy/40 text-sm mb-8 leading-relaxed">
              This section of the Diamond Orthotic Laboratory website is
              currently under development. Need immediate assistance?
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                to="/"
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
              >
                <ArrowLeft size={14} /> Home
              </Link>
              <Link
                to="/contact"
                className="px-5 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
              >
                Contact Lab
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
