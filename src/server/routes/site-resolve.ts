import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { lookupSiteForDebug, resolveSiteCacheSize } from "../../middleware/resolveSite.js";

/**
 * `GET /__site_resolve?host=<hostname>` — returns the resolved site (or
 * `null`) plus the cache_hit flag and the per-process cache size. Useful
 * while DNS / Cloud Run domain mappings are in flight.
 *
 * Behind `requireAdmin` (`X-Admin-Token`) so it isn't a tenant-enumeration
 * surface for the public internet.
 */
export function siteResolveRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  router.get(
    "/__site_resolve",
    requireAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      const host = String(req.query.host ?? "").trim();
      if (!host) {
        res.status(400).json({ error: "host query param required" });
        return;
      }
      try {
        const { site, cache_hit } = await lookupSiteForDebug(pool, host);
        res.json({
          host,
          resolved: site,
          source: site?.matched_via ?? null,
          cache_hit,
          cache_size: resolveSiteCacheSize(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
