/* eslint-disable camelcase */

// W1.4 (product-audit remediation, D300/D1105/D612) — real Stop.
//
// `cancel_requested`: the cancellation channel between the Stop route
// (POST .../conversations/:id/stop sets it) and the turn loop / job handler
// (which consume it at batch boundaries and between tool calls, then halt).
//
// `stopped`: a new honest terminal status for an operator-cancelled turn —
// distinct from 'error' (nothing failed) and 'active' (the turn did NOT run
// to completion). Claimable again like 'error' (a follow-up message resumes).
exports.up = (pgm) => {
  pgm.addColumn("ai_conversations", {
    cancel_requested: { type: "boolean", notNull: true, default: false },
  });
  pgm.dropConstraint("ai_conversations", "ai_conversations_status_check");
  pgm.addConstraint("ai_conversations", "ai_conversations_status_check", {
    check: "status IN ('active','error','archived','running','stopped')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("ai_conversations", "ai_conversations_status_check");
  // 'stopped' rows would violate the restored constraint — fold them into
  // 'error' (the closest pre-migration terminal state; also claimable).
  pgm.sql(`UPDATE ai_conversations SET status = 'error' WHERE status = 'stopped'`);
  pgm.addConstraint("ai_conversations", "ai_conversations_status_check", {
    check: "status IN ('active','error','archived','running')",
  });
  pgm.dropColumn("ai_conversations", "cancel_requested");
};
