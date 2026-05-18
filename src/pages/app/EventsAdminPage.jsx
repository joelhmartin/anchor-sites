import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Calendar,
  X,
} from "lucide-react";
import { useEventsStore } from "../../stores/events.store.js";

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
  time: "",
  location: "",
  image: "",
  excerpt: "",
  body: "",
  category: "Community",
  published: false,
};

function EventFormModal({ event, onClose, onSave }) {
  const [form, setForm] = useState(event || EMPTY_FORM);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-surface-200">
          <h2 className="font-heading font-bold text-xl">
            {event ? "Edit Event" : "New Event"}
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

          <div className="grid grid-cols-2 gap-4">
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
                Time
              </label>
              <input
                type="text"
                value={form.time}
                onChange={(e) => set("time", e.target.value)}
                placeholder="e.g. 8:00 AM"
                className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
                Location
              </label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
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
                <option>Community</option>
                <option>Workshop</option>
                <option>Social</option>
                <option>Fundraiser</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1.5">
              Image URL
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
              Excerpt (short description)
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
              Full Content (Markdown)
            </label>
            <textarea
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              rows={10}
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300/50 text-navy text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => set("published", e.target.checked)}
                className="w-4 h-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500/20"
              />
              <span className="text-sm text-navy/70">Published (visible on site)</span>
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
              {event ? "Save Changes" : "Create Event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EventsAdminPage() {
  const events = useEventsStore((s) => s.events);
  const createEvent = useEventsStore((s) => s.createEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);

  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const handleCreate = () => {
    setEditingEvent(null);
    setShowModal(true);
  };

  const handleEdit = (event) => {
    setEditingEvent(event);
    setShowModal(true);
  };

  const handleSave = (data) => {
    if (editingEvent) {
      updateEvent(editingEvent.id, data);
    } else {
      createEvent(data);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm("Delete this event?")) {
      deleteEvent(id);
    }
  };

  const handleTogglePublish = (event) => {
    updateEvent(event.id, { published: !event.published });
  };

  const sorted = [...events].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-2xl text-navy tracking-tight">
            Events
          </h1>
          <p className="text-navy/50 text-sm mt-1">
            Create and manage community events.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
        >
          <Plus size={16} />
          New Event
        </button>
      </div>

      {/* Events list */}
      <div className="space-y-3">
        {sorted.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-surface-200/60 hover:shadow-sm transition-shadow"
          >
            {/* Thumbnail */}
            {event.image && (
              <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                <img
                  src={event.image}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-heading font-bold text-sm text-navy truncate">
                  {event.title}
                </h3>
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    event.published
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-surface-200 text-navy/40"
                  }`}
                >
                  {event.published ? "Published" : "Draft"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-navy/40 text-xs">
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  {formatDate(event.date)}
                </span>
                <span>{event.category}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => handleTogglePublish(event)}
                className="p-2 rounded-lg text-navy/30 hover:text-navy/70 hover:bg-surface-100 transition-colors"
                title={event.published ? "Unpublish" : "Publish"}
              >
                {event.published ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button
                onClick={() => handleEdit(event)}
                className="p-2 rounded-lg text-navy/30 hover:text-brand-500 hover:bg-brand-50 transition-colors"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => handleDelete(event.id)}
                className="p-2 rounded-lg text-navy/30 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <EventFormModal
          event={editingEvent}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
