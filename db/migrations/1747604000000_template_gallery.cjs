/** @type {import('node-pg-migrate').MigrationBuilder} */

// Template gallery metadata (Task C1, lovable-workspace) — prerequisite for
// the new-site template gallery UI (B4) and the 10-template library (C5+).
// `category` groups templates in the gallery (e.g. "Basic"); `cover_image_url`
// is the gallery card thumbnail; `sort_order` controls display order within a
// category (list queries order by sort_order asc, then name).

exports.up = function (pgm) {
  pgm.addColumns("templates", {
    category: { type: "text" },
    cover_image_url: { type: "text" },
    sort_order: { type: "integer", notNull: true, default: 0 },
  });
};

exports.down = function (pgm) {
  pgm.dropColumns("templates", ["category", "cover_image_url", "sort_order"]);
};
