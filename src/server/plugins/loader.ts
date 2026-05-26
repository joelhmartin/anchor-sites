import type { Express } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { getPlugin, listPlugins } from "./registry.js";
import { hasBlock, registerBlock } from "../../blocks/registry.js";
import { resolveSite } from "../../middleware/resolveSite.js";

/**
 * Plugin loader / boot composition (P7.5-T7.5.4, D-016 / D-045).
 *
 * Two phases, kept separate so `createApp` stays synchronous:
 *
 *   1. `verifyPluginMigrations(pool)` — ASYNC, at boot. For each registered
 *      plugin, checks its `requiredEnv` is present and its declared
 *      `plg_<name>_` tables exist. Returns the `active` names + `skipped`
 *      {name, reason}. Fail-soft: a plugin whose migration hasn't run (or whose
 *      env is missing) is skipped, never crashes boot.
 *
 *   2. `loadPlugins(app, { only })` — SYNC, inside `createApp`. Registers each
 *      (active) plugin's blocks into the global block registry (namespaced
 *      types, guarded so repeated app creation in tests doesn't double-
 *      register) and mounts its router once at `/api/plugins/<name>`. Per-site
 *      enablement is enforced inside the router via `req.site.plugins`, not
 *      here — blocks/routes exist globally; enablement gates USE.
 *
 * `createApp` calls `loadPlugins(app, { only: activePlugins })` with the set
 * `verifyPluginMigrations` returned at boot; with no `only` it loads every
 * registered plugin (the default for tests).
 */

export type PluginVerifyResult = {
  active: string[];
  skipped: Array<{ name: string; reason: string }>;
};

export async function verifyPluginMigrations(
  opts: { pool?: Pool } = {},
): Promise<PluginVerifyResult> {
  const pool = opts.pool ?? defaultPool;
  const active: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const manifest of listPlugins()) {
    const missingEnv = (manifest.requiredEnv ?? []).filter((e) => !process.env[e]);
    if (missingEnv.length > 0) {
      skipped.push({ name: manifest.name, reason: `missing env: ${missingEnv.join(", ")}` });
      continue;
    }

    const tables = manifest.migrations?.tables ?? [];
    if (tables.length > 0) {
      const res = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [tables],
      );
      const found = new Set(res.rows.map((r) => r.table_name));
      const missing = tables.filter((t) => !found.has(t));
      if (missing.length > 0) {
        skipped.push({ name: manifest.name, reason: `missing tables: ${missing.join(", ")}` });
        continue;
      }
    }

    active.push(manifest.name);
  }

  return { active, skipped };
}

export type LoadPluginsResult = {
  mounted: string[];
  blocksRegistered: string[];
};

export function loadPlugins(
  app: Express,
  opts: { only?: string[]; pool?: Pool } = {},
): LoadPluginsResult {
  const pool = opts.pool ?? defaultPool;
  const names = opts.only ?? listPlugins().map((p) => p.name);
  const mounted: string[] = [];
  const blocksRegistered: string[] = [];

  // Plugin routers are tenant-facing: resolve the site (pass-through on miss so
  // non-tenant/unknown hosts still reach the router, which 404s via its guard)
  // so plugin routes can gate on `req.site.plugins` (P7.5-T7.5.5/7).
  const resolver = resolveSite({ pool, passThroughOnMiss: true });

  for (const name of names) {
    const manifest = getPlugin(name);
    if (!manifest) continue;

    for (const block of manifest.blocks ?? []) {
      if (!hasBlock(block.type)) {
        const { type, ...entry } = block;
        registerBlock(type, entry);
        blocksRegistered.push(type);
      }
    }

    if (manifest.createRouter) {
      app.use(`/api/plugins/${name}`, resolver, manifest.createRouter({ pool, pluginName: name }));
    }
    mounted.push(name);
  }

  return { mounted, blocksRegistered };
}
