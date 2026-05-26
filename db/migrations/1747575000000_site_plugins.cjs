/* eslint-disable camelcase */

// P7.5-T7.5.1 — site_plugins (D-016, refined by D-0xx Phase 7.5).
//
// Per-site plugin enablement + config. One row per (site, plugin). A plugin is
// "installed" when a row exists; `enabled` gates whether the loader mounts it
// for that site. Config is split:
//   - `config`           : NON-secret config (plaintext jsonb, no key needed).
//   - `config_encrypted` : the plugin's `secretConfigKeys` values, AES-256-GCM
//                          enveloped (`{v, iv, tag, ciphertext}`) — D-0xx. Null
//                          when the plugin has no secret config (or none set).
//
// This refines D-016's single `config_encrypted JSONB` column into a
// plaintext/encrypted pair so non-secret config is storable + queryable without
// the encryption key present. Plugins own their OWN tables (prefixed
// `plg_<name>_`) in their own migrations; this core table only tracks
// enablement + config and must not be altered by plugins.
//
// `touch_updated_at` already exists (sites/pages migration); reused here.

exports.up = (pgm) => {
  pgm.createTable("site_plugins", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    plugin_name: { type: "text", notNull: true },
    version: { type: "text", notNull: true },
    enabled: { type: "boolean", notNull: true, default: false },
    config: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    config_encrypted: { type: "jsonb" },
    installed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("site_plugins", "site_plugins_site_name_unique", {
    unique: ["site_id", "plugin_name"],
  });
  // Partial index: the hot path is "enabled plugins for this site" (loader +
  // resolveSite). Indexing only enabled rows keeps it small.
  pgm.createIndex("site_plugins", "site_id", {
    name: "site_plugins_enabled_idx",
    where: "enabled",
  });
  pgm.createTrigger("site_plugins", "site_plugins_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });
};

exports.down = (pgm) => {
  pgm.dropTrigger("site_plugins", "site_plugins_touch_updated_at");
  pgm.dropTable("site_plugins");
  // touch_updated_at is owned by the sites/pages migration — leave it.
};
