/* eslint-disable camelcase */

// W2-CONC / D1119 — fencing token for the stale-takeover race.
//
// `claimConversationTurn`'s turn lock is stealable by design: a `running`
// conversation whose `updated_at` is >10 minutes stale can be re-claimed
// (crashed-worker takeover). The acknowledged-but-deferred gap (the old
// comment at admin-ai-agent.ts:203-210): a worker that HUNG past that window
// (rather than dying) could later finish and release the NEWER claimant's
// `running` back to `active`, letting two turns interleave writes and
// Anthropic history. `claim_seq` is the minimal fence: every successful
// claim increments it and returns the new value as the claim's token;
// releases/terminal writes carry their token and no-op when it no longer
// matches (i.e. the claim was superseded). Monotonic per conversation —
// bigint so it can never realistically wrap.

exports.up = (pgm) => {
  pgm.addColumn("ai_conversations", {
    claim_seq: { type: "bigint", notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("ai_conversations", "claim_seq");
};
