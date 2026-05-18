import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Star,
  Calendar,
  X,
} from "lucide-react";
import { usePostsStore } from "../../stores/posts.store.js";

function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const EMPTY_FORM = {
  title: "",
  date: "",
  author: "",
  category: "General",
  tags: [],
  image: "",
  excerpt: "",
  body: "",
  published: false,
  featured: false,
};

function PostFormModal({ post, onClose, onSave }) {
  const [form, setForm] = useState(
    post
      ? { ...post, tags: (post.tags || []).join(", ") }
      : { ...EMPTY_FORM, tags: "" }
  );

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({ ...form, tags });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-surface-200">
          <h2 className="font-heading font-bold text-xl">
            {post ? "Edit Post" : "New Post"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-surface-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
                Author
              </label>
              <input
                type="text"
                value={form.author}
                onChange={(e) => set("author", e.target.value)}
                placeholder="e.g. charlie"
                className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              >
                <option>General</option>
                <option>Updates</option>
                <option>Insights</option>
                <option>Community</option>
                <option>News</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="lorem, ipsum, placeholder"
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Featured Image URL
            </label>
            <input
              type="url"
              value={form.image}
              onChange={(e) => set("image", e.target.value)}
              placeholder="https://images.pexels.com/..."
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Excerpt
            </label>
            <textarea
              value={form.excerpt}
              onChange={(e) => set("excerpt", e.target.value)}
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Content (Markdown)
            </label>
            <textarea
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              rows={12}
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none"
            />
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => set("published", e.target.checked)}
                className="w-4 h-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500/20"
              />
              <span className="text-sm text-navy/70">Published</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => set("featured", e.target.checked)}
                className="w-4 h-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500/20"
              />
              <span className="text-sm text-navy/70">Featured</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-sm font-medium text-navy/60 hover:bg-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              {post ? "Save Changes" : "Create Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PostsAdminPage() {
  const posts = usePostsStore((s) => s.posts);
  const createPost = usePostsStore((s) => s.createPost);
  const updatePost = usePostsStore((s) => s.updatePost);
  const deletePost = usePostsStore((s) => s.deletePost);

  const [showModal, setShowModal] = useState(false);
  const [editingPost, setEditingPost] = useState(null);

  const handleCreate = () => {
    setEditingPost(null);
    setShowModal(true);
  };

  const handleEdit = (post) => {
    setEditingPost(post);
    setShowModal(true);
  };

  const handleSave = (data) => {
    if (editingPost) {
      updatePost(editingPost.id, data);
    } else {
      createPost(data);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm("Delete this post?")) {
      deletePost(id);
    }
  };

  const sorted = [...posts].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-2xl text-navy tracking-tight">
            Blog Posts
          </h1>
          <p className="text-navy/50 text-sm mt-1">
            Create and manage blog content.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
        >
          <Plus size={16} />
          New Post
        </button>
      </div>

      <div className="space-y-3">
        {sorted.map((post) => (
          <div
            key={post.id}
            className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-surface-200/60 hover:shadow-sm transition-shadow"
          >
            {post.image && (
              <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                <img src={post.image} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-heading font-bold text-sm text-navy truncate">
                  {post.title}
                </h3>
                {post.featured && (
                  <Star size={12} className="text-accent-500 fill-accent-500 flex-shrink-0" />
                )}
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    post.published
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-surface-200 text-navy/40"
                  }`}
                >
                  {post.published ? "Published" : "Draft"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-navy/40 text-xs">
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  {formatDate(post.date)}
                </span>
                <span>{post.category}</span>
                <span>{post.readTime} min read</span>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => updatePost(post.id, { published: !post.published })}
                className="p-2 rounded-lg text-navy/30 hover:text-navy/70 hover:bg-surface-100 transition-colors"
                title={post.published ? "Unpublish" : "Publish"}
              >
                {post.published ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button
                onClick={() => handleEdit(post)}
                className="p-2 rounded-lg text-navy/30 hover:text-brand-500 hover:bg-brand-50 transition-colors"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => handleDelete(post.id)}
                className="p-2 rounded-lg text-navy/30 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <PostFormModal
          post={editingPost}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
