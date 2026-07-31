/* eslint-disable camelcase */

// D516 + D609 (W2-DOM of the 2026-07-30 product-audit remediation).
//
// site_domains rows carry status (verification_status/ssl_status) but no
// telemetry about it:
//   - D516: no timestamp records WHEN a status changed — created_at is the
//     only time column, so "pending for 3 minutes" and "pending since last
//     Tuesday" are indistinguishable (and the D515 re-verification sweep
//     needs a "stale pending" predicate).
//   - D609: no column records WHY a row is 'failed' — the actual error
//     (e.g. the Webmaster-Central PermissionDenied that is today's common
//     provisioning failure) lives only in pg-boss job output and Cloud
//     Logging, so the UI can only render the bare word "failed".
//
// All three columns are written by the single guarded transition helper
// (src/server/domains/status.ts, D608) — not by ad-hoc UPDATEs.

exports.up = (pgm) => {
  pgm.addColumn("site_domains", {
    // Detail of the most recent failure; cleared when the domain recovers.
    last_error: { type: "text" },
    // Touched on every status transition.
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    // Set when verification_status first transitions to 'verified' (and on
    // every re-verification after a non-verified spell).
    verified_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("site_domains", "last_error");
  pgm.dropColumn("site_domains", "updated_at");
  pgm.dropColumn("site_domains", "verified_at");
};
