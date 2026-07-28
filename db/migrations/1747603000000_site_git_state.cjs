/* eslint-disable camelcase */

// GitHub sync state (Task 1 of the GitHub sync plan — see
// docs/superpowers/specs/2026-07-28-github-sync-design.md). One row per site,
// upserted by state-repo.ts's setGitEnabled. Mirrors ai_conversations'
// explicit-bump rationale (see 1747601000000_ai_agent.cjs): `updated_at` does
// NOT use the shared touch_updated_at trigger — the recordExport/recordImport/
// recordGitError functions in state-repo.ts set `updated_at = now()`
// themselves alongside the field they're actually changing, so a blanket
// BEFORE UPDATE trigger can't perturb it out of step with those writes.

exports.up = (pgm) => {
  pgm.createTable("site_git_state", {
    site_id: { type: "uuid", primaryKey: true, references: '"sites"', onDelete: "CASCADE" },
    enabled: { type: "boolean", notNull: true, default: false },
    last_export_sha: { type: "text" },
    last_import_sha: { type: "text" },
    last_synced_at: { type: "timestamptz" },
    last_error: { type: "text" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("site_git_state");
};
