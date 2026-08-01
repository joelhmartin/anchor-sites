/* eslint-disable camelcase */

// D620 (W2-JOBS of the 2026-07-30 product-audit remediation).
//
// A template materialization that fails after retries (or whose enqueue
// failed entirely) left a site with ZERO pages and ZERO recorded state — the
// wizard polled pages_count with a bounded timeout then "proceeded anyway"
// silently, landing the operator in a workspace that would never populate,
// with no error and no retry affordance.
//
// Record the materialize OUTCOME on the site itself, so the UI can read a
// definite state instead of inferring from the side effect (page count):
//   - materialize_status: 'pending' (enqueued, not yet done) | 'ready'
//     (materialized) | 'failed' (handler exhausted retries, or the enqueue
//     never happened). NULL = site wasn't created from a template.
//   - materialize_error: the failing detail, cleared on success.

exports.up = (pgm) => {
  pgm.addColumn("sites", {
    materialize_status: { type: "text" }, // null | 'pending' | 'ready' | 'failed'
    materialize_error: { type: "text" },
  });
  pgm.addConstraint("sites", "sites_materialize_status_check", {
    check: "materialize_status IS NULL OR materialize_status IN ('pending', 'ready', 'failed')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("sites", "sites_materialize_status_check");
  pgm.dropColumn("sites", "materialize_status");
  pgm.dropColumn("sites", "materialize_error");
};
