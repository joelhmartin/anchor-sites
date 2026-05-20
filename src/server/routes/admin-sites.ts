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

  // GET /api/sites/:siteId — detail with page + media counts. P4-T4.3.
  router.get(
    "/sites/:siteId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const result = await pool.query(
          `SELECT s.id, s.slug, s.display_name, s.status,
                  s.default_brand_tokens, s.created_at,
                  (SELECT COUNT(*)::int FROM pages WHERE site_id = s.id) AS pages_count,
                  (SELECT COUNT(*)::int FROM media_assets WHERE site_id = s.id) AS media_count
             FROM sites s
            WHERE s.id = $1`,
          [siteId],
        );
        if (result.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        res.json({ site: result.rows[0] });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/pages — pages list, most-recently-updated first. P4-T4.3.
  router.get(
    "/sites/:siteId/pages",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const result = await pool.query(
          `SELECT id, slug, title, status, updated_at
             FROM pages
            WHERE site_id = $1
            ORDER BY updated_at DESC`,
          [siteId],
        );
        res.json({ pages: result.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/media — media list, newest first, paginated. P4-T4.4.
  router.get(
    "/sites/:siteId/media",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const totalRes = await pool.query<{ count: string }>(
          `SELECT COUNT(*) FROM media_assets WHERE site_id = $1`,
          [siteId],
        );
        const result = await pool.query(
          `SELECT id, alt, content_type, focal_point, variants_status,
                  variants, width, height, created_at
             FROM media_assets
            WHERE site_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
          [siteId, limit, offset],
        );
        res.json({
          media: result.rows,
          total: Number(totalRes.rows[0].count),
          limit,
          offset,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
