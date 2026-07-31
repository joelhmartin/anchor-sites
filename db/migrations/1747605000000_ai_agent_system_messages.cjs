/* eslint-disable camelcase */

// W1.4 (product-audit remediation, D601/D303/D1103): transcript-visible
// system rows. A build that dies (worker death mid-turn, a queued job that
// never starts, a continuation that couldn't be enqueued, an operator Stop)
// must explain itself IN the transcript — but ai_messages only allowed
// 'user'/'assistant'/'tool', all of which are replayed verbatim into the
// Anthropic context on the next turn. 'system' rows are UI-only annotations:
// rendered as the amber SystemLine in the chat transcript
// (src/admin/components/agent-chat/history.ts) and FILTERED OUT of the
// model-facing history rebuild (loop.ts's buildApiMessages).
exports.up = (pgm) => {
  pgm.dropConstraint("ai_messages", "ai_messages_role_check");
  pgm.addConstraint("ai_messages", "ai_messages_role_check", {
    check: "role IN ('user','assistant','tool','system')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("ai_messages", "ai_messages_role_check");
  pgm.addConstraint("ai_messages", "ai_messages_role_check", {
    check: "role IN ('user','assistant','tool')",
  });
};
