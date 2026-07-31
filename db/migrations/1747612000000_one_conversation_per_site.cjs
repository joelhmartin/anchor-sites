/* eslint-disable camelcase */

// W2-CONC / D302 — one conversation per site, enforced by the database.
//
// The turn lock is per-conversation, but conversation CREATION had no
// per-site dedupe: two tabs (or a tab whose bootstrap found no conversation
// yet) could each mint their own conversation and run two agent builds
// against the same site concurrently, interleaving writes — and each tab's
// bootstrap `find()` then shadowed the other's conversation (the D324 orphan
// twin). A unique partial index on (site_id) over the non-archived rows makes
// the invariant structural: at most ONE live conversation per site, with
// `archived` as the terminal state that frees the slot. The route goes
// through `getOrCreateConversation` (repo.ts), whose INSERT uses this index
// as its ON CONFLICT arbiter, so N racing creates converge on one row.
//
// Existing twins (data predating this migration): keep the conversation the
// operator is most likely looking at — a `running` one first (mid-build),
// else the most recently active — and archive the rest. Archived
// conversations aren't deleted; their history stays for the (W2-TERM D324)
// history surface.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE ai_conversations SET status = 'archived'
    WHERE status <> 'archived'
      AND id NOT IN (
        SELECT DISTINCT ON (site_id) id FROM ai_conversations
        WHERE status <> 'archived'
        ORDER BY site_id, (status = 'running') DESC, updated_at DESC, id DESC
      )
  `);
  pgm.createIndex("ai_conversations", ["site_id"], {
    name: "ai_conversations_one_active_per_site",
    unique: true,
    where: "status <> 'archived'",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("ai_conversations", ["site_id"], {
    name: "ai_conversations_one_active_per_site",
  });
};
