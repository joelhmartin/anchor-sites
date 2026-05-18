import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import gsap from "gsap";
import { CalendarDays, Clock, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { usePostsStore } from "../../stores/posts.store.js";
import { CONTENT, blogUrl, blogPageUrl } from "../../config/site.js";
import { ContentSidebar } from "../../components/marketing/ContentSidebar.jsx";

/* ── Scroll reveal ── */
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
            opacity: 1, y: 0,
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

function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const { perPage } = CONTENT.blog;

/* ─── FEATURED POST HERO ─── */
function FeaturedPost({ post }) {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-feat]", {
        y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: "power3.out", delay: 0.3,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref}>
      <Link
        to={blogUrl(post.slug)}
        className="group block relative h-[70dvh] min-h-[500px] flex items-end overflow-hidden"
      >
        <div className="absolute inset-0">
          <img
            src={post.image}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/60 to-transparent" />
        </div>

        <div className="relative z-10 section-pad pb-16 md:pb-24 max-w-4xl">
          <div data-feat className="flex items-center gap-3 mb-5">
            <span className="px-3 py-1 rounded-full bg-brand-500 text-white text-xs font-semibold">
              Featured
            </span>
            <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white/70 text-xs font-medium">
              {post.category}
            </span>
          </div>

          <h1
            data-feat
            className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-white tracking-tight leading-[1.05]"
          >
            {post.title}
          </h1>

          <p
            data-feat
            className="mt-5 text-white/60 text-base md:text-lg max-w-2xl leading-relaxed"
          >
            {post.excerpt}
          </p>

          <div data-feat className="mt-6 flex items-center gap-6 text-white/40 text-sm">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} />
              {formatDate(post.date)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={14} />
              {post.readTime} min read
            </span>
          </div>

          <div
            data-feat
            className="mt-8 inline-flex items-center gap-2 text-brand-400 font-semibold text-sm group-hover:gap-3 transition-all duration-300"
          >
            Read Article
            <ArrowRight size={16} />
          </div>
        </div>
      </Link>
    </section>
  );
}

/* ─── POST CARD ─── */
function PostCard({ post }) {
  return (
    <Link
      to={blogUrl(post.slug)}
      className="group block bg-white rounded-3xl border border-surface-200/60 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 overflow-hidden"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={post.image}
          alt={post.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-4 left-4">
          <span className="px-3 py-1 rounded-full bg-white/90 backdrop-blur-sm text-brand-600 text-xs font-semibold">
            {post.category}
          </span>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center gap-4 text-navy/40 text-xs mb-3">
          <span className="flex items-center gap-1.5">
            <CalendarDays size={12} />
            {formatDate(post.date)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            {post.readTime} min read
          </span>
        </div>

        <h3 className="font-heading font-bold text-lg text-navy tracking-tight leading-snug group-hover:text-brand-500 transition-colors mb-2">
          {post.title}
        </h3>
        <p className="text-navy/55 text-sm leading-relaxed line-clamp-2">
          {post.excerpt}
        </p>

        <div className="mt-4 flex items-center gap-2 text-brand-500 text-sm font-semibold">
          Read More
          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

/* ─── CATEGORY FILTER ─── */
function CategoryFilter({ categories, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange(null)}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
          !active
            ? "bg-brand-500 text-white border-brand-500"
            : "bg-white text-navy/60 border-surface-300 hover:border-brand-300"
        }`}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
            active === cat
              ? "bg-brand-500 text-white border-brand-500"
              : "bg-white text-navy/60 border-surface-300 hover:border-brand-300"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}

/* ─── PAGINATION ─── */
function Pagination({ currentPage, totalPages }) {
  if (totalPages <= 1) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) pages.push(i);

  return (
    <nav className="flex items-center justify-center gap-2 mt-14">
      {/* Prev */}
      {currentPage > 1 ? (
        <Link
          to={blogPageUrl(currentPage - 1)}
          className="w-10 h-10 rounded-full border border-surface-300 flex items-center justify-center text-navy/50 hover:text-brand-500 hover:border-brand-300 transition-colors"
        >
          <ChevronLeft size={16} />
        </Link>
      ) : (
        <span className="w-10 h-10 rounded-full border border-surface-200 flex items-center justify-center text-navy/20">
          <ChevronLeft size={16} />
        </span>
      )}

      {/* Page numbers */}
      {pages.map((num) => (
        <Link
          key={num}
          to={blogPageUrl(num)}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
            num === currentPage
              ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
              : "border border-surface-300 text-navy/50 hover:text-brand-500 hover:border-brand-300"
          }`}
        >
          {num}
        </Link>
      ))}

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          to={blogPageUrl(currentPage + 1)}
          className="w-10 h-10 rounded-full border border-surface-300 flex items-center justify-center text-navy/50 hover:text-brand-500 hover:border-brand-300 transition-colors"
        >
          <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="w-10 h-10 rounded-full border border-surface-200 flex items-center justify-center text-navy/20">
          <ChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}

/* ─── PAGE EXPORT ─── */
export function BlogPage() {
  const { page: pageParam } = useParams();
  const currentPage = Math.max(1, parseInt(pageParam, 10) || 1);
  const allPosts = usePostsStore((s) => s.posts);
  const [activeCategory, setActiveCategory] = useState(null);

  const published = allPosts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const featured = currentPage === 1 ? published.find((p) => p.featured) : null;
  const rest = published.filter((p) => p !== featured);
  const categories = [...new Set(published.map((p) => p.category))];

  // Apply category filter
  const filtered = activeCategory
    ? rest.filter((p) => p.category === activeCategory)
    : rest;

  // Paginate
  const totalPages = perPage > 0 ? Math.ceil(filtered.length / perPage) : 1;
  const paginated = perPage > 0
    ? filtered.slice((currentPage - 1) * perPage, currentPage * perPage)
    : filtered;

  const gridRef = useRef(null);
  useScrollReveal(gridRef, "[data-post-card]", { y: 30, stagger: 0.1 });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage]);

  // Reset category filter when page changes
  useEffect(() => {
    setActiveCategory(null);
  }, [currentPage]);

  return (
    <>
      {/* Featured hero — only on page 1 */}
      {featured && <FeaturedPost post={featured} />}

      {/* Blog grid + sidebar */}
      <section ref={gridRef} className="section-pad py-16 md:py-24">
        <div className="max-w-7xl mx-auto">
          {/* Header + filter */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-600 text-xs font-medium mb-4 tracking-wide">
                {CONTENT.blog.label}
              </div>
              <h2 className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight">
                Insights &{" "}
                <span className="font-drama italic text-brand-500 text-4xl md:text-5xl">
                  Resources
                </span>
              </h2>
            </div>
            <CategoryFilter
              categories={categories}
              active={activeCategory}
              onChange={setActiveCategory}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 lg:gap-12">
            {/* Main content */}
            <div>
              {paginated.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-navy/40 text-lg">No posts found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {paginated.map((post) => (
                    <div key={post.id} data-post-card>
                      <PostCard post={post} />
                    </div>
                  ))}
                </div>
              )}

              {!activeCategory && <Pagination currentPage={currentPage} totalPages={totalPages} />}
            </div>

            {/* Sidebar */}
            <div className="hidden lg:block">
              <div className="sticky top-24">
                <ContentSidebar
                  title="Get in Touch"
                  subtitle="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec sed odio dui."
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
