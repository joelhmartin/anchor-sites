/* eslint-disable camelcase */

// Bot-review fix wave, item 1 (Codex P1 — serialize turns per conversation).
// A second `POST .../messages` while a turn is already running can interleave
// invalid Anthropic history + conflicting mutations. The route/job now claim
// the conversation atomically via `status='running'` before starting a turn
// and release it back to 'active'/'error' when done — this adds 'running' to
// the allowed status set (drop + re-add the CHECK constraint, matching the
// original inline `check:` in 1747601000000_ai_agent.cjs).

exports.up = (pgm) => {
  pgm.dropConstraint("ai_conversations", "ai_conversations_status_check");
  pgm.addConstraint("ai_conversations", "ai_conversations_status_check", {
    check: "status IN ('active','error','archived','running')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("ai_conversations", "ai_conversations_status_check");
  pgm.addConstraint("ai_conversations", "ai_conversations_status_check", {
    check: "status IN ('active','error','archived')",
  });
};
