/* eslint-disable camelcase */

// P3-T3.4 — optional per-page brand-token override JSONB. NULL means
// "use the site default unchanged". Validated at admin save against
// brandTokensSchema (D-029). Merged into the SSR'd :root by P3-T3.5.

exports.up = (pgm) => {
  pgm.addColumn("pages", {
    brand_tokens_override: {
      type: "jsonb",
      // NULLABLE — most pages won't override.
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("pages", "brand_tokens_override");
};
