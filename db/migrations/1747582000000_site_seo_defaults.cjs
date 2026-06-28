/* eslint-disable camelcase */

// P9-T9.3 — site-level SEO defaults (D-049). A `seo_defaults` JSONB blob on
// `sites` (titleTemplate, defaultDescription, defaultOgImageAssetId,
// twitterHandle) applied UNDER per-page `seo` (page wins). Default '{}' so
// existing sites are valid "no defaults set".

exports.up = (pgm) => {
  pgm.addColumn("sites", {
    seo_defaults: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("sites", "seo_defaults");
};
