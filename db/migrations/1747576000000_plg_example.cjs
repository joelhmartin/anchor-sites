/* eslint-disable camelcase */

// P7.5-T7.5.7 — reference plugin table (D-016 / D-045).
//
// The in-repo `example` reference plugin owns this ONE table, demonstrating
// the v1 plugin-migration path: plugin tables are prefixed `plg_<name>_` and
// applied via the standard `migrate:up` run (per the Phase-7.5 design note).
// Plugins must never alter core tables. The example plugin itself only
// self-registers at boot when ENABLE_EXAMPLE_PLUGIN=true (default off), so this
// table is created in every environment but is otherwise inert in prod.

exports.up = (pgm) => {
  pgm.createTable("plg_example_notes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    note: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("plg_example_notes", ["site_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("plg_example_notes");
};
