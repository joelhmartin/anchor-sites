import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";

/**
 * Site-plugins repository (P7.5-T7.5.1, D-016). Pool-injected (defaults to the
 * shared pool) so routes, the loader, and tests share one implementation.
 *
 * Config is split across two columns (see the migration / D-0xx):
 *   - `config`           : non-secret config, plaintext jsonb.
 *   - `config_encrypted` : the plugin's secret config, AES-256-GCM enveloped
 *                          (`EncryptedEnvelope`) by the crypto helper (T7.5.3),
 *                          or null. The repo treats it as an opaque blob — it
 *                          never encrypts/decrypts; the route layer does that.
 */

/** Persisted shape of an encrypted secret blob (produced by `crypto.ts`, T7.5.3). */
export type EncryptedEnvelope = {
  /** envelope version, for future key-rotation / algo changes */
  v: 1;
  /** base64 IV */
  iv: string;
  /** base64 GCM auth tag */
  tag: string;
  /** base64 ciphertext of the JSON-encoded secret object */
  ciphertext: string;
};

export type SitePluginRow = {
  id: string;
  site_id: string;
  plugin_name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  config_encrypted: EncryptedEnvelope | null;
  installed_at: Date;
  updated_at: Date;
};

const COLS =
  "id, site_id, plugin_name, version, enabled, config, config_encrypted, installed_at, updated_at";

/**
 * Install or update a site's plugin row, writing the FULL intended state
 * (callers pass the complete desired config). Idempotent on
 * `(site_id, plugin_name)`. On first install missing fields default to
 * `enabled=false`, `config={}`, `config_encrypted=null`.
 */
export async function upsertSitePlugin(
  input: {
    siteId: string;
    pluginName: string;
    version: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    configEncrypted?: EncryptedEnvelope | null;
  },
  opts: { pool?: Pool } = {},
): Promise<SitePluginRow> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<SitePluginRow>(
    `INSERT INTO site_plugins (site_id, plugin_name, version, enabled, config, config_encrypted)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (site_id, plugin_name) DO UPDATE
       SET version = EXCLUDED.version,
           enabled = EXCLUDED.enabled,
           config = EXCLUDED.config,
           config_encrypted = EXCLUDED.config_encrypted
     RETURNING ${COLS}`,
    [
      input.siteId,
      input.pluginName,
      input.version,
      input.enabled ?? false,
      JSON.stringify(input.config ?? {}),
      input.configEncrypted ? JSON.stringify(input.configEncrypted) : null,
    ],
  );
  return res.rows[0];
}

/** List a site's installed plugins (enabled or not), ordered by name. */
export async function listSitePlugins(
  siteId: string,
  opts: { pool?: Pool } = {},
): Promise<SitePluginRow[]> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<SitePluginRow>(
    `SELECT ${COLS} FROM site_plugins WHERE site_id = $1 ORDER BY plugin_name ASC`,
    [siteId],
  );
  return res.rows;
}

/** Fetch one (site, plugin) row, or null if the plugin isn't installed for the site. */
export async function getSitePlugin(
  siteId: string,
  pluginName: string,
  opts: { pool?: Pool } = {},
): Promise<SitePluginRow | null> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<SitePluginRow>(
    `SELECT ${COLS} FROM site_plugins WHERE site_id = $1 AND plugin_name = $2`,
    [siteId, pluginName],
  );
  return res.rowCount && res.rowCount > 0 ? res.rows[0] : null;
}

/**
 * The hot path for `resolveSite` (T7.5.5): the names + versions of a site's
 * ENABLED plugins. Uses the partial `site_plugins_enabled_idx`.
 */
export async function getEnabledPlugins(
  siteId: string,
  opts: { pool?: Pool } = {},
): Promise<Array<{ name: string; version: string }>> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<{ plugin_name: string; version: string }>(
    `SELECT plugin_name, version FROM site_plugins
      WHERE site_id = $1 AND enabled = true
      ORDER BY plugin_name ASC`,
    [siteId],
  );
  return res.rows.map((r) => ({ name: r.plugin_name, version: r.version }));
}

/** Toggle a plugin's enabled flag. Returns the updated row, or null if not installed. */
export async function setEnabled(
  siteId: string,
  pluginName: string,
  enabled: boolean,
  opts: { pool?: Pool } = {},
): Promise<SitePluginRow | null> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<SitePluginRow>(
    `UPDATE site_plugins SET enabled = $3
      WHERE site_id = $1 AND plugin_name = $2
      RETURNING ${COLS}`,
    [siteId, pluginName, enabled],
  );
  return res.rowCount && res.rowCount > 0 ? res.rows[0] : null;
}

/**
 * Replace a plugin's config columns. `configEncrypted = null` clears the
 * stored secrets. Returns the updated row, or null if the plugin isn't
 * installed for the site.
 */
export async function setConfig(
  siteId: string,
  pluginName: string,
  config: Record<string, unknown>,
  configEncrypted: EncryptedEnvelope | null,
  opts: { pool?: Pool } = {},
): Promise<SitePluginRow | null> {
  const pool = opts.pool ?? defaultPool;
  const res = await pool.query<SitePluginRow>(
    `UPDATE site_plugins SET config = $3::jsonb, config_encrypted = $4::jsonb
      WHERE site_id = $1 AND plugin_name = $2
      RETURNING ${COLS}`,
    [
      siteId,
      pluginName,
      JSON.stringify(config),
      configEncrypted ? JSON.stringify(configEncrypted) : null,
    ],
  );
  return res.rowCount && res.rowCount > 0 ? res.rows[0] : null;
}
