import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { evictSiteCacheForSite } from "../../middleware/resolveSite.js";
import { getPlugin, listPlugins } from "../plugins/registry.js";
import type { PluginManifest } from "../plugins/manifest.js";
import { decryptConfig, encryptConfig } from "../plugins/crypto.js";
import {
  getSitePlugin,
  listSitePlugins,
  upsertSitePlugin,
  type SitePluginRow,
} from "../plugins/repo.js";

/**
 * Admin plugins API (P7.5-T7.5.6, D-016 / D-044 / D-045). Mounted at `/api`,
 * gated per-route by `requireAdmin`. Lists available plugins (from the runtime
 * registry), reports per-site install/enable state, and installs/enables/
 * disables + sets per-site config. Secret config (`secretConfigKeys`) is
 * encrypted at rest and NEVER returned to the client — only its set/unset
 * status is surfaced.
 */

const putPayload = z.object({
  enabled: z.boolean().optional(),
  /** Full desired config (non-secret + secret values). Validated against the
   * plugin's configSchema. Authoritative-replace: an omitted/empty secret is
   * cleared (D-044). Omit `config` entirely to only toggle `enabled`. */
  config: z.record(z.unknown()).optional(),
});

/** Public shape of a registered plugin (no live values). */
function describePlugin(m: PluginManifest) {
  return {
    name: m.name,
    version: m.version,
    required_env: m.requiredEnv ?? [],
    secret_config_keys: m.secretConfigKeys ?? [],
    has_router: typeof m.createRouter === "function",
    blocks: (m.blocks ?? []).map((b) => ({
      type: b.type,
      label: b.label,
      description: b.description,
      category: b.category,
    })),
    config_schema: m.configSchema
      ? zodToJsonSchema(m.configSchema, { $refStrategy: "none" })
      : null,
  };
}

/** The secret keys that currently have a stored value (names only, never values). */
function secretsSet(manifest: PluginManifest, row: SitePluginRow | null): string[] {
  if (!row?.config_encrypted) return [];
  try {
    const secret = decryptConfig(row.config_encrypted);
    const keys = manifest.secretConfigKeys ?? [];
    return keys.filter((k) => secret[k] !== undefined && secret[k] !== "");
  } catch {
    // Key unavailable / envelope unreadable — report none rather than leak.
    return [];
  }
}

/** Per-site view of an installed plugin — config minus any secret values. */
function describeSitePlugin(manifest: PluginManifest, row: SitePluginRow) {
  return {
    plugin_name: row.plugin_name,
    version: row.version,
    enabled: row.enabled,
    config: row.config,
    secrets_set: secretsSet(manifest, row),
    installed_at: row.installed_at,
    updated_at: row.updated_at,
  };
}

export type PluginsRouterOptions = { pool?: Pool };

export function pluginsRouter(opts: PluginsRouterOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();

  // GET /api/plugins — every registered/available plugin.
  router.get("/plugins", admin, (_req: Request, res: Response) => {
    res.json({ plugins: listPlugins().map(describePlugin) });
  });

  // GET /api/sites/:siteId/plugins — per-site install/enable state (secrets redacted).
  router.get(
    "/sites/:siteId/plugins",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [req.params.siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const rows = await listSitePlugins(req.params.siteId, { pool });
        const installed = rows
          .map((row) => {
            const manifest = getPlugin(row.plugin_name);
            return manifest ? describeSitePlugin(manifest, row) : null;
          })
          .filter((x): x is ReturnType<typeof describeSitePlugin> => x !== null);
        res.json({ plugins: installed });
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /api/sites/:siteId/plugins/:name — install/enable/disable + set config.
  router.put(
    "/sites/:siteId/plugins/:name",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = putPayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message })),
        });
        return;
      }
      const { siteId, name } = req.params;
      const manifest = getPlugin(name);
      if (!manifest) {
        res.status(404).json({ error: "plugin not registered", name });
        return;
      }

      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const existing = await getSitePlugin(siteId, name, { pool });

        // Resolve config: when `config` is provided, validate the full object
        // against the plugin's configSchema, then split secret vs non-secret
        // and encrypt the secret subset. When omitted, preserve existing config.
        let configToStore = existing?.config ?? {};
        let configEncrypted = existing?.config_encrypted ?? null;

        if (parsed.data.config !== undefined) {
          if (!manifest.configSchema) {
            res.status(400).json({ error: "plugin takes no config" });
            return;
          }
          const cfgParse = manifest.configSchema.safeParse(parsed.data.config);
          if (!cfgParse.success) {
            res.status(400).json({
              error: "invalid plugin config",
              details: cfgParse.error.errors.map((e) => ({
                path: e.path.join(".") || "(root)",
                message: e.message,
              })),
            });
            return;
          }
          const validated = cfgParse.data as Record<string, unknown>;
          const secretKeys = new Set(manifest.secretConfigKeys ?? []);

          // Preserve previously-stored secrets the form didn't resend (the API
          // never returns secret values, so a config form can't echo them back).
          // A non-empty value updates the secret; an omitted/empty one keeps it.
          let mergedSecret: Record<string, unknown> = {};
          if (existing?.config_encrypted) {
            try {
              mergedSecret = decryptConfig(existing.config_encrypted);
            } catch {
              mergedSecret = {};
            }
          }
          const nonSecret: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(validated)) {
            if (secretKeys.has(k)) {
              if (typeof v === "string" && v !== "") mergedSecret[k] = v;
            } else {
              nonSecret[k] = v;
            }
          }
          configToStore = nonSecret;
          configEncrypted = Object.keys(mergedSecret).length > 0 ? encryptConfig(mergedSecret) : null;
        }

        const enabled = parsed.data.enabled ?? existing?.enabled ?? false;

        const row = await upsertSitePlugin(
          {
            siteId,
            pluginName: name,
            version: manifest.version,
            enabled,
            config: configToStore,
            configEncrypted,
          },
          { pool },
        );

        // Toggle takes effect immediately — drop the site's resolve cache so
        // req.site.plugins reflects the change (P7.5-T7.5.5).
        await evictSiteCacheForSite(pool, siteId).catch(() => undefined);

        res.json({ plugin: describeSitePlugin(manifest, row) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
