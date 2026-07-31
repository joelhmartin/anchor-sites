/* eslint-disable camelcase */

// D1116 (W2-SEC, 2026-07-30 product-audit remediation) — tombstones for
// deleted pages.
//
// `delete_page` is the AI agent's ONLY irreversible tool: every other write
// leaves a page_revisions row to restore from, but page_revisions has
// ON DELETE CASCADE from pages — the delete destroys the very history that
// would undo it. This table is the smallest recovery mechanism: the agent's
// delete_page copies the full page row (content + publish state) here inside
// the same transaction, so a model misfire is recoverable by re-inserting
// the tombstone's payload as a new page. Deliberately NOT an FK to pages
// (the page row is gone by design); site-scoped with CASCADE so deleting a
// whole site still cleans up.

exports.up = (pgm) => {
  pgm.createTable("deleted_pages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    // The original pages.id — plain uuid, no FK (the row it named is gone).
    page_id: { type: "uuid", notNull: true },
    slug: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    blocks: { type: "jsonb", notNull: true },
    seo: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    brand_tokens_override: { type: "jsonb" },
    status: { type: "text", notNull: true },
    published_snapshot: { type: "jsonb" },
    sort_order: { type: "integer" },
    published_at: { type: "timestamptz" },
    // Mirrors page_revisions.source ('ai' for the agent tool; future callers
    // may record 'manual' etc.).
    deleted_by: { type: "text", notNull: true, default: "ai" },
    deleted_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("deleted_pages", ["site_id", "deleted_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("deleted_pages");
};
