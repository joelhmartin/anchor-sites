/* eslint-disable camelcase */

// P7-T7.1 — templates + template_pages (D-041).
//
// A template is a reusable snapshot of pages (block JSON) + brand tokens.
// `kind='site'` templates carry many pages + brand tokens and materialize a
// whole new site (pg-boss job, D-042); `kind='page'` templates carry a single
// page and are inserted into an existing site. Captured blocks keep their
// source media `asset_id`s — referenced images render from the immutable
// public GCS variant URLs (D-043); no media is copied in v1.
//
// `source_site_id` is the site a template was captured from. ON DELETE SET
// NULL so deleting the source site doesn't destroy templates derived from it.
// `touch_updated_at` already exists (sites/pages migration); reused here.

exports.up = (pgm) => {
  pgm.createTable("templates", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    source_site_id: {
      type: "uuid",
      references: '"sites"',
      onDelete: "SET NULL",
    },
    kind: {
      type: "text",
      notNull: true,
      default: "site",
      check: "kind IN ('site', 'page')",
    },
    brand_tokens: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: "text",
      notNull: true,
      default: "active",
      check: "status IN ('active', 'archived')",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("templates", ["kind", "status"]);
  pgm.createTrigger("templates", "templates_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });

  pgm.createTable("template_pages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    template_id: {
      type: "uuid",
      notNull: true,
      references: '"templates"',
      onDelete: "CASCADE",
    },
    slug: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    blocks: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    seo: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("template_pages", "template_pages_template_slug_unique", {
    unique: ["template_id", "slug"],
  });
  pgm.createIndex("template_pages", ["template_id", "sort_order"]);
  pgm.createIndex("template_pages", "blocks", { method: "gin" });
};

exports.down = (pgm) => {
  pgm.dropTable("template_pages");
  pgm.dropTrigger("templates", "templates_touch_updated_at");
  pgm.dropTable("templates");
  // touch_updated_at is owned by the sites/pages migration — leave it.
};
