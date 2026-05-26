/* eslint-disable camelcase */

// P8-T8.10 — events (D-047, Track B). Per-site, scoped by `site_id`.
// `description` is a Block[] (D-001) — same renderer/editor/AI path as posts,
// validated on write (D-039). Ordered by `starts_at`; `status` gates public
// visibility (mirrors posts).

exports.up = (pgm) => {
  pgm.createTable("events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: { type: "uuid", notNull: true, references: '"sites"', onDelete: "CASCADE" },
    slug: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    description: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    starts_at: { type: "timestamptz", notNull: true },
    ends_at: { type: "timestamptz" },
    location: { type: "text" },
    status: {
      type: "text",
      notNull: true,
      default: "draft",
      check: "status IN ('draft','published')",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("events", "events_site_slug_unique", { unique: ["site_id", "slug"] });
  pgm.createIndex("events", ["site_id", "starts_at"], { name: "events_site_starts_idx" });
  pgm.createTrigger("events", "events_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });
};

exports.down = (pgm) => {
  pgm.dropTrigger("events", "events_touch_updated_at");
  pgm.dropTable("events");
};
