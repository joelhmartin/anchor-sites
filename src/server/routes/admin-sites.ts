import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";

/**
 * Admin sites API (P4-T4.2 …). Read + light-write surface the control
 * hub needs: list sites, site detail, create. Page + media sub-resources
 * and PATCH land in 4.3–4.6. All routes gated by `requireAdmin`
 * (per-route, so unmatched /api paths fall through to 404).
 */

export type AdminSitesOptions = {
  pool?: Pool;
};

export function adminSitesRouter(opts: AdminSitesOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();

  // GET /api/sites — list with page counts, newest first.
  router.get(
    "/sites",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await pool.query(
          `SELECT s.id, s.slug, s.display_name, s.status, s.created_at,
                  COUNT(p.id)::int AS pages_count
             FROM sites s
             LEFT JOIN pages p ON p.site_id = s.id
            GROUP BY s.id
            ORDER BY s.created_at DESC`,
        );
        res.json({ sites: result.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
