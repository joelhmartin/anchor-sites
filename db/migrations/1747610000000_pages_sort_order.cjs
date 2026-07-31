/* eslint-disable camelcase */

// D702 (W1.6 of the 2026-07-30 product-audit remediation).
//
// Authored page order must survive materialization: TemplatePageSeed
// .sort_order is authored per template page and stored on template_pages,
// but `pages` had no ordering column, so materialize dropped it and every
// pages list fell back to insertion accident (updated_at DESC).
//
// `sort_order` is nullable by design: NULL means "not authored" (pages
// created by hand or by the agent) and sorts LAST in creation order —
// every consumer orders `sort_order ASC NULLS LAST, created_at ASC`.
// Materialize populates it from the template page's sort_order.

exports.up = (pgm) => {
  pgm.addColumn("pages", {
    sort_order: { type: "integer" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("pages", "sort_order");
};
