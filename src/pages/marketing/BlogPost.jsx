import { useEffect } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import {
  CalendarDays,
  Clock,
  ArrowLeft,
  ArrowRight,
  User,
  Tag,
} from "lucide-react";
import { usePostsStore } from "../../stores/posts.store.js";
import { BUSINESS, CONTENT, blogUrl } from "../../config/site.js";
import { ContentSidebar } from "../../components/marketing/ContentSidebar.jsx";

function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Markdown-lite renderer */
function RenderBody({ text }) {
  const lines = text.split("\n");
  const elements = [];
  let listBuffer = [];

  const flushList = () => {
    if (listBuffer.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="space-y-2.5 my-5 ml-1">
          {listBuffer.map((li, i) => (
            <li key={i} className="flex items-start gap-3 text-navy/65 text-[17px] leading-relaxed">
              <span className="text-brand-500 mt-2 w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
              <span dangerouslySetInnerHTML={{ __html: boldify(li) }} />
            </li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  const boldify = (s) =>
    s.replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold text-navy'>$1</strong>");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      flushList();
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h4 key={i} className="font-heading font-bold text-xl text-navy mt-10 mb-3 tracking-tight">
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={i} className="font-heading font-bold text-2xl md:text-3xl text-navy mt-14 mb-4 tracking-tight">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
    } else {
      flushList();
      elements.push(
        <p
          key={i}
          className="text-navy/65 text-[17px] leading-[1.8] my-4"
          dangerouslySetInnerHTML={{ __html: boldify(line) }}
        />
      );
    }
  }

  flushList();
  return <>{elements}</>;
}

/* ─── RELATED POSTS ─── */
function RelatedPosts({ currentId, category }) {
  const allPosts = usePostsStore((s) => s.posts);
  const related = allPosts
    .filter((p) => p.published && p.id !== currentId)
    .filter((p) => p.category === category)
    .slice(0, 2);

  if (!related.length) {
    const fallback = allPosts
      .filter((p) => p.published && p.id !== currentId)
      .slice(0, 2);
    if (!fallback.length) return null;
    return <RelatedGrid posts={fallback} />;
  }

  return <RelatedGrid posts={related} />;
}

function RelatedGrid({ posts }) {
  return (
    <section className="section-pad py-16 md:py-20 bg-surface-100">
      <div className="max-w-4xl mx-auto">
        <h3 className="font-heading font-bold text-xl text-navy mb-8">
          Keep Reading
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {posts.map((post) => (
            <Link
              key={post.id}
              to={blogUrl(post.slug)}
              className="group flex gap-4 bg-white rounded-2xl p-4 border border-surface-200/60 hover:shadow-md transition-all duration-300"
            >
              <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0">
                <img
                  src={post.image}
                  alt={post.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-brand-500 text-xs font-semibold">
                  {post.category}
                </span>
                <h4 className="font-heading font-bold text-sm text-navy leading-snug mt-1 group-hover:text-brand-500 transition-colors line-clamp-2">
                  {post.title}
                </h4>
                <span className="text-navy/40 text-xs mt-1.5 flex items-center gap-1">
                  <Clock size={10} />
                  {post.readTime} min read
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── PAGE EXPORT ─── */
export function BlogPostPage() {
  const { slug } = useParams();
  const post = usePostsStore((s) => s.posts.find((p) => p.slug === slug));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!post) return <Navigate to={CONTENT.blog.listPath} replace />;

  return (
    <>
      {/* Hero image */}
      <section className="relative h-[55dvh] min-h-[400px] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={post.image}
            alt={post.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/60 to-navy/20" />
        </div>
        <div className="relative z-10 section-pad pb-12 md:pb-16 max-w-4xl">
          <Link
            to={CONTENT.blog.listPath}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-white/60 text-xs font-medium mb-5 hover:bg-white/20 transition-colors"
          >
            <ArrowLeft size={12} />
            All Posts
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 rounded-full bg-brand-500 text-white text-xs font-semibold">
              {post.category}
            </span>
          </div>
          <h1 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl text-white tracking-tight leading-tight">
            {post.title}
          </h1>
        </div>
      </section>

      {/* Article + sidebar */}
      <section className="section-pad py-12 md:py-16">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 lg:gap-12">
          {/* Main content */}
          <div className="max-w-3xl">
            {/* Meta bar */}
            <div className="flex flex-wrap items-center gap-5 py-6 mb-8 border-b border-surface-300/40">
              <span className="flex items-center gap-2 text-navy/50 text-sm">
                <CalendarDays size={15} className="text-brand-500" />
                {formatDate(post.date)}
              </span>
              <span className="flex items-center gap-2 text-navy/50 text-sm">
                <Clock size={15} className="text-brand-500" />
                {post.readTime} min read
              </span>
            </div>

            {/* Body */}
            <article>
              <RenderBody text={post.body} />
            </article>

            {/* Tags */}
            {post.tags?.length > 0 && (
              <div className="mt-12 pt-8 border-t border-surface-300/40">
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size={14} className="text-navy/30" />
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 rounded-full bg-surface-200 text-navy/50 text-xs font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom CTA */}
            <div className="mt-12 bg-brand-500 rounded-3xl p-8 md:p-10 text-center relative overflow-hidden">
              <h3 className="font-heading font-bold text-2xl text-white tracking-tight">
                Need support?
              </h3>
              <p className="mt-2 text-white/70 text-sm max-w-md mx-auto">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                Praesent commodo cursus magna vel scelerisque.
              </p>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 mt-5 px-6 py-3 rounded-full bg-white text-brand-600 font-semibold text-sm hover:bg-brand-50 transition-colors"
              >
                Get in Touch
                <ArrowRight size={14} />
              </Link>
            </div>

            {/* Back */}
            <div className="mt-8">
              <Link
                to={CONTENT.blog.listPath}
                className="inline-flex items-center gap-2 text-brand-500 text-sm font-semibold hover:gap-3 transition-all"
              >
                <ArrowLeft size={14} />
                Back to Blog
              </Link>
            </div>
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
      </section>

      {/* Related */}
      <RelatedPosts currentId={post.id} category={post.category} />
    </>
  );
}
