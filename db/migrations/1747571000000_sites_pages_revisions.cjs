/* eslint-disable camelcase */

exports.up = (pgm) => {
  // Shared trigger function for updated_at maintenance.
  pgm.createFunction(
    "touch_updated_at",
    [],
    {
      returns: "trigger",
      language: "plpgsql",
      replace: true,
    },
    "BEGIN NEW.updated_at = now(); RETURN NEW; END;",
  );

  // sites
  pgm.createTable("sites", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "text", notNull: true, unique: true },
    display_name: { type: "text", notNull: true },
    status: {
      type: "text",
      notNull: true,
      default: "active",
      check: "status IN ('active', 'archived', 'suspended')",
    },
    default_brand_tokens: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // site_domains — populated by Phase 10 (domain provisioning); schema now
  pgm.createTable("site_domains", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    hostname: { type: "text", notNull: true, unique: true },
    is_primary: { type: "boolean", notNull: true, default: false },
    verification_status: {
      type: "text",
      notNull: true,
      default: "pending",
      check: "verification_status IN ('pending', 'verified', 'failed')",
    },
    ssl_status: {
      type: "text",
      notNull: true,
      default: "pending",
      check: "ssl_status IN ('pending', 'active', 'failed')",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("site_domains", "site_id");

  // pages — block JSON is the source of truth (D-001)
  pgm.createTable("pages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    slug: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    blocks: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    seo: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: "text",
      notNull: true,
      default: "draft",
      check: "status IN ('draft', 'published')",
    },
    published_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("pages", "pages_site_slug_unique", { unique: ["site_id", "slug"] });
  pgm.createIndex("pages", ["site_id", "status"]);
  pgm.createIndex("pages", "blocks", { method: "gin" });
  pgm.createTrigger("pages", "pages_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });

  // page_revisions — every save inserts one row; restore = new revision row
  pgm.createTable("page_revisions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    page_id: {
      type: "uuid",
      notNull: true,
      references: '"pages"',
      onDelete: "CASCADE",
    },
    blocks: { type: "jsonb", notNull: true },
    seo: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    // author_id is nullable until Phase 8 lands an auth_users table; type stays uuid
    // so the FK can be added later without a data migration.
    author_id: { type: "uuid" },
    source: { type: "text", notNull: true, default: "manual" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("page_revisions", ["page_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("page_revisions");
  pgm.dropTrigger("pages", "pages_touch_updated_at");
  pgm.dropTable("pages");
  pgm.dropTable("site_domains");
  pgm.dropTable("sites");
  pgm.dropFunction("touch_updated_at", []);
};
