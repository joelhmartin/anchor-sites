import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import { createSiteWithDomains, SiteSlugConflictError } from "../sites/create-site.js";
import { siteSeoDefaultsSchema } from "../seo/schema.js";

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

const patchSitePayload = z
  .object({
    display_name: z.string().min(1).max(200).optional(),
    default_brand_tokens: brandTokensSchema.optional(),
    // P9-T9.3 — site-level SEO defaults (titleTemplate, defaultDescription,
    // defaultOgImageAssetId, twitterHandle).
    seo_defaults: siteSeoDefaultsSchema.optional(),
    // P11-T11.1 (D-052) — CTM account ID. Null clears it (removes CTM script).
    ctm_account_id: z.string().max(200).nullable().optional(),
  })
  .refine(
    (v) =>
      v.display_name !== undefined ||
      v.default_brand_tokens !== undefined ||
      v.seo_defaults !== undefined ||
      v.ctm_account_id !== undefined,
    {
      message:
        "at least one of display_name, default_brand_tokens, seo_defaults or ctm_account_id is required",
    },
  );

const createPagePayload = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen"),
  title: z.string().min(1).max(200),
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
        const { siteId, canonical, canonicalDomainId } = await createSiteWithDomains(client, {
          slug,
          displayName: display_name,
          brandTokens: default_brand_tokens,
        });
        await client.query("COMMIT");
        // P10-10.8: canonical domain row is created in site_domains (pending).
        // Trigger provisioning via POST /api/sites/:id/domains/:domainId/provision
        // (available in the Studio Domains tab) to map it on Cloud Run.
        res.status(201).json({
          site: {
            id: siteId,
            slug,
            display_name,
            status: "active",
            default_brand_tokens: default_brand_tokens ?? {},
            canonical_hostname: canonical,
            canonical_domain_id: canonicalDomainId,
          },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof SiteSlugConflictError) {
          res.status(409).json({ error: "slug already in use" });
          return;
        }
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
                  s.default_brand_tokens, s.seo_defaults, s.ctm_account_id, s.crm_site_id,
                  s.created_at,
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

  // PATCH /api/sites/:siteId — update display_name and/or brand tokens. P4-T4.6.
  router.patch(
    "/sites/:siteId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = patchSitePayload.safeParse(req.body);
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
      const { siteId } = req.params;
      const { display_name, default_brand_tokens, seo_defaults, ctm_account_id } = parsed.data;
      try {
        // ctm_account_id: undefined = not in payload (leave as-is); null = explicit clear.
        const ctmValue = ctm_account_id === undefined ? undefined : ctm_account_id;
        const result = await pool.query<{ id: string }>(
          `UPDATE sites
              SET display_name = COALESCE($1, display_name),
                  default_brand_tokens = COALESCE($2::jsonb, default_brand_tokens),
                  seo_defaults = COALESCE($3::jsonb, seo_defaults),
                  ctm_account_id = CASE WHEN $5 THEN $4 ELSE ctm_account_id END
            WHERE id = $6
            RETURNING id`,
          [
            display_name ?? null,
            default_brand_tokens ? JSON.stringify(default_brand_tokens) : null,
            seo_defaults ? JSON.stringify(seo_defaults) : null,
            ctmValue ?? null,
            ctmValue !== undefined,
            siteId,
          ],
        );
        if (result.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        // Evict resolveSite cache for every hostname pointing at this site
        // so the next request sees fresh brand tokens (P3-T3.1 helper).
        const hosts = await pool.query<{ hostname: string }>(
          `SELECT hostname FROM site_domains WHERE site_id = $1`,
          [siteId],
        );
        for (const row of hosts.rows) evictSiteCache(row.hostname);

        const updated = await pool.query(
          `SELECT id, slug, display_name, status, default_brand_tokens, seo_defaults,
                  ctm_account_id, crm_site_id, created_at FROM sites WHERE id = $1`,
          [siteId],
        );
        res.json({ site: updated.rows[0] });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/sites/:siteId/pages — create an empty page + initial revision. P4-T4.6.
  router.post(
    "/sites/:siteId/pages",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = createPagePayload.safeParse(req.body);
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
      const { siteId } = req.params;
      const { slug, title } = parsed.data;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const siteOk = await client.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "site not found" });
          return;
        }
        const dup = await client.query(
          `SELECT 1 FROM pages WHERE site_id = $1 AND slug = $2`,
          [siteId, slug],
        );
        if (dup.rowCount && dup.rowCount > 0) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "a page with that slug already exists on this site" });
          return;
        }
        const pageRes = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
           VALUES ($1, $2, $3, '[]'::jsonb, '{}'::jsonb, 'draft')
           RETURNING id, created_at`,
          [siteId, slug, title],
        );
        const pageId = pageRes.rows[0].id;
        await client.query(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, '[]'::jsonb, '{}'::jsonb, 'create')`,
          [pageId],
        );
        await client.query("COMMIT");
        res.status(201).json({
          page: { id: pageId, site_id: siteId, slug, title, status: "draft" },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
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
