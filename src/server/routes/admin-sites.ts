import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
import { getDomainConfig, hostnameForSlug } from "../../config/domain.js";

/**
 * Admin sites API (P4-T4.2 …). Read + light-write surface the control
 * hub needs: list sites, site detail, create, update. Page + media
 * sub-resources too. All routes gated by `requireAdmin` (per-route, so
 * unmatched /api paths fall through to 404).
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const createSitePayload = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen"),
  display_name: z.string().min(1).max(200),
  default_brand_tokens: brandTokensSchema.optional(),
});

export type AdminSitesOptions = {
  pool?: Pool;
  createRateLimit?: RateLimitOptions;
};

export function adminSitesRouter(opts: AdminSitesOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();
  const createLimiter = rateLimit(opts.createRateLimit ?? { max: 10, windowMs: 60_000 });

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

  // POST /api/sites — create a site + canonical site_domains rows. P4-T4.5.
  router.post(
    "/sites",
    admin,
    createLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = createSitePayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({
            path: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
        return;
      }
      const { slug, display_name, default_brand_tokens } = parsed.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const dup = await client.query(`SELECT 1 FROM sites WHERE slug = $1`, [slug]);
        if (dup.rowCount && dup.rowCount > 0) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "slug already in use" });
          return;
        }

        const siteRes = await client.query<{ id: string }>(
          `INSERT INTO sites (slug, display_name, default_brand_tokens)
           VALUES ($1, $2, $3::jsonb)
           RETURNING id`,
          [slug, display_name, JSON.stringify(default_brand_tokens ?? {})],
        );
        const siteId = siteRes.rows[0].id;

        // Canonical hostname + local-dev hostname (matches db/seed.ts).
        const cfg = getDomainConfig();
        const canonical = hostnameForSlug(slug, cfg);
        const localhostName = `${slug}.localhost`;
        await client.query(
          `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
           VALUES ($1, $2, true, 'pending', 'pending')`,
          [siteId, canonical],
        );
        await client.query(
          `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
           VALUES ($1, $2, false, 'verified', 'active')`,
          [siteId, localhostName],
        );

        await client.query("COMMIT");
        res.status(201).json({
          site: {
            id: siteId,
            slug,
            display_name,
            status: "active",
            default_brand_tokens: default_brand_tokens ?? {},
            canonical_hostname: canonical,
          },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
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
