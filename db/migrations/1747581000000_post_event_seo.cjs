/* eslint-disable camelcase */

// P9-T9.1 — SEO layer (D-049). Posts and events join pages in carrying a `seo`
// JSONB blob (shared `seoFieldsSchema`: title/description/canonical/robots/og/
// twitter). Default '{}' so existing rows are valid "no SEO set". Pages already
// have their `seo` column (P3); this only backfills the two P8 content types.

exports.up = (pgm) => {
  for (const table of ["posts", "events"]) {
    pgm.addColumn(table, {
      seo: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    });
  }
};

exports.down = (pgm) => {
  for (const table of ["posts", "events"]) {
    pgm.dropColumn(table, "seo");
  }
};
