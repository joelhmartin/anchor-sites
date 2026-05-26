/* eslint-disable camelcase */

// P8-T8.9 — blog posts (D-047, Track B). Per-site, scoped by `site_id`.
// `body` is a Block[] (D-001) so posts render through the SAME block renderer
// and are editable with Puck (D-017) + AI (Phase 6); validated on write
// through the shared registry validator (D-039). `author_id` → tenant_auth_user
// (P8-T8.7), nullable + SET NULL so deleting a member keeps their posts.

exports.up = (pgm) => {
  pgm.createTable("posts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: { type: "uuid", notNull: true, references: '"sites"', onDelete: "CASCADE" },
    slug: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    excerpt: { type: "text" },
    body: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    status: {
      type: "text",
      notNull: true,
      default: "draft",
      check: "status IN ('draft','published')",
    },
    published_at: { type: "timestamptz" },
    author_id: { type: "text", references: '"tenant_auth_user"', onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("posts", "posts_site_slug_unique", { unique: ["site_id", "slug"] });
  pgm.createIndex("posts", "body", { method: "gin", name: "posts_body_gin" });
  // Hot path: published posts for a site, newest first.
  pgm.createIndex("posts", ["site_id", "status", "published_at"], { name: "posts_site_status_idx" });
  pgm.createTrigger("posts", "posts_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });
};

exports.down = (pgm) => {
  pgm.dropTrigger("posts", "posts_touch_updated_at");
  pgm.dropTable("posts");
};
