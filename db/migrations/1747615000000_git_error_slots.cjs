/* eslint-disable camelcase */

// D616 (W2-JOBS of the 2026-07-30 product-audit remediation).
//
// site_git_state.last_error was a SINGLE slot written by export failures,
// import failures, AND import validation summaries — and recordExport /
// recordImport unconditionally NULLed it on success. So a successful export
// erased a still-unresolved import validation report (and vice versa):
// GitCard's error display was last-writer-wins across two unrelated
// pipelines.
//
// Split into per-direction slots, each cleared ONLY by its own direction's
// success (recordExport clears last_export_error; recordImport clears
// last_import_error). The legacy `last_error` column is left in place but no
// longer written by state-repo.ts — a W3-DATA pass can drop it once nothing
// reads it.

exports.up = (pgm) => {
  pgm.addColumn("site_git_state", {
    last_export_error: { type: "text" },
    last_import_error: { type: "text" },
  });
  // Best-effort backfill: the old shared slot most commonly held an import
  // validation summary (the only recurring failure while export is a rare
  // contention loss), but we can't know its direction for sure — seed BOTH so
  // no existing error silently vanishes on upgrade; the next success in each
  // direction clears its own slot.
  pgm.sql(`
    UPDATE site_git_state
       SET last_export_error = last_error,
           last_import_error = last_error
     WHERE last_error IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn("site_git_state", "last_export_error");
  pgm.dropColumn("site_git_state", "last_import_error");
};
