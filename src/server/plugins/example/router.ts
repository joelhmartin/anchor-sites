import { Router, type Request, type Response, type NextFunction } from "express";
import type { PluginRouterContext } from "../manifest.js";
import { requireSitePlugin } from "../guard.js";
import { getSitePlugin } from "../repo.js";

/**
 * Reference-plugin router (P7.5-T7.5.7). Mounted at `/api/plugins/example`,
 * behind `resolveSite` (loader) so `req.site` is set. Every route is gated by
 * `requireSitePlugin` so only sites with the plugin enabled can reach it —
 * demonstrating per-site enablement enforced INSIDE the router (D-045).
 *
 *   GET  /ping        — liveness + echoes the site slug and the non-secret
 *                       `greeting` from this site's plugin config.
 *   GET  /notes       — list this site's notes (uses the owned plg_ table).
 *   POST /notes       — add a note { note }.
 */
export function createExampleRouter(ctx: PluginRouterContext): Router {
  const { pool, pluginName } = ctx;
  const r = Router();
  const gate = requireSitePlugin(pluginName);

  r.get("/ping", gate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const installed = await getSitePlugin(req.site!.id, pluginName, { pool });
      const greeting = (installed?.config?.greeting as string) ?? "hi";
      res.json({ ok: true, plugin: pluginName, site: req.site!.slug, greeting });
    } catch (err) {
      next(err);
    }
  });

  r.get("/notes", gate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await pool.query<{ id: string; note: string; created_at: Date }>(
        `SELECT id, note, created_at FROM plg_example_notes
          WHERE site_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.site!.id],
      );
      res.json({ notes: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  r.post("/notes", gate, async (req: Request, res: Response, next: NextFunction) => {
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!note) {
      res.status(400).json({ error: "note is required" });
      return;
    }
    try {
      const ins = await pool.query<{ id: string; note: string; created_at: Date }>(
        `INSERT INTO plg_example_notes (site_id, note) VALUES ($1, $2)
         RETURNING id, note, created_at`,
        [req.site!.id, note],
      );
      res.status(201).json({ note: ins.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
