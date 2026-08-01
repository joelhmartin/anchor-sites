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
import { resolveCrmClient } from "../crm/resolve.js";
import type { CrmClient } from "../crm/client.js";
import { getBoss, CRM_SYNC_JOB } from "../jobs/index.js";
import type { CrmSyncInput } from "../crm/sync-job.js";
import { SYSTEM_TEMPLATES_SITE_SLUG } from "../templates/system-site.js";
import { PAGE_HAS_UNPUBLISHED_CHANGES_SQL } from "../publish-snapshot.js";

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
    // P12-T12.1 (D-054) — analytics opt-out per site.
    analytics_disabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.display_name !== undefined ||
      v.default_brand_tokens !== undefined ||
      v.seo_defaults !== undefined ||
      v.ctm_account_id !== undefined ||
      v.analytics_disabled !== undefined,
    {
      message:
        "at least one of display_name, default_brand_tokens, seo_defaults, ctm_account_id or analytics_disabled is required",
    },
  );

const createPagePayload = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen"),
  title: z.string().min(1).max(200),
});

export type AdminSitesOptions = {
  pool?: Pool;
  createRateLimit?: RateLimitOptions;
  /** Injectable CRM client for tests. Defaults to resolveCrmClient(). */
  crmClient?: CrmClient;
};

export function adminSitesRouter(opts: AdminSitesOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const crmClient = opts.crmClient ?? resolveCrmClient(process.env);
  const router = Router();
  const admin = requireAdmin();
  const createLimiter = rateLimit(opts.createRateLimit ?? { max: 10, windowMs: 60_000 });

  // GET /api/sites — list with page counts, newest first.
  router.get(
    "/sites",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        // Excludes the reserved system site that owns template gallery
        // cover images (Task C4 fix round 1) — it's not a real site and
        // has nothing an operator would ever manage here.
        const result = await pool.query(
          `SELECT s.id, s.slug, s.display_name, s.status, s.created_at,
                  COUNT(p.id)::int AS pages_count
             FROM sites s
             LEFT JOIN pages p ON p.site_id = s.id
            WHERE s.slug != $1
            GROUP BY s.id
            ORDER BY s.created_at DESC`,
          [SYSTEM_TEMPLATES_SITE_SLUG],
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
        const { siteId, canonical, canonicalDomainId, enqueueProvision, provisionCrm } =
          await createSiteWithDomains(client, {
            slug,
            displayName: display_name,
            brandTokens: default_brand_tokens,
            crmClient,
          });
        await client.query("COMMIT");
        // Final review item 4: enqueue AFTER the commit so the provision
        // worker can never pick the job up before the site row is visible
        // to it (and a rolled-back create leaves no orphan job behind).
        await enqueueProvision();
        // D1013: the CRM network call also runs post-COMMIT — never inside
        // the transaction (it held a pooled connection for up to 10s).
        await provisionCrm();
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
                  s.analytics_disabled, s.created_at,
                  s.materialize_status, s.materialize_error,
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
        // D923 — same readiness contract as the publish response (2b): the
        // client must never present the URL as live before the mapping is
        // actually Ready (unprovisioned hostnames TLS-refuse, verified live).
        const domainRes = await pool.query<{
          hostname: string;
          verification_status: string;
          ssl_status: string;
        }>(
          `SELECT hostname, verification_status, ssl_status
             FROM site_domains WHERE site_id = $1 AND is_primary = true LIMIT 1`,
          [siteId],
        );
        const domain = domainRes.rows[0];
        res.json({
          site: {
            ...result.rows[0],
            live_url: domain?.hostname ? `https://${domain.hostname}` : null,
            live_url_ready:
              domain?.verification_status === "verified" && domain?.ssl_status === "active",
            live_url_status: domain
              ? {
                  verification_status: domain.verification_status,
                  ssl_status: domain.ssl_status,
                }
              : null,
          },
        });
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
        // D301: `has_unpublished_changes` — drafts, plus published pages
        // whose working copy diverged from the published snapshot. The
        // workspace Publish pill counts THIS flag, so it can never again
        // say "Nothing to publish" while edits are sitting unshipped.
        // D702: authored order first (pages.sort_order, populated by
        // materialize from the template), then creation order for pages
        // added afterwards (NULL sort_order sorts last).
        const result = await pool.query(
          `SELECT id, slug, title, status, updated_at, sort_order,
                  ${PAGE_HAS_UNPUBLISHED_CHANGES_SQL} AS has_unpublished_changes
             FROM pages
            WHERE site_id = $1
            ORDER BY sort_order ASC NULLS LAST, created_at ASC, slug ASC`,
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
      const { display_name, default_brand_tokens, seo_defaults, ctm_account_id, analytics_disabled } = parsed.data;
      try {
        // ctm_account_id: undefined = not in payload (leave as-is); null = explicit clear.
        const ctmValue = ctm_account_id === undefined ? undefined : ctm_account_id;
        const result = await pool.query<{ id: string }>(
          `UPDATE sites
              SET display_name = COALESCE($1, display_name),
                  default_brand_tokens = COALESCE($2::jsonb, default_brand_tokens),
                  seo_defaults = COALESCE($3::jsonb, seo_defaults),
                  ctm_account_id = CASE WHEN $5 THEN $4 ELSE ctm_account_id END,
                  analytics_disabled = CASE WHEN $7 THEN $6 ELSE analytics_disabled END
            WHERE id = $8
            RETURNING id`,
          [
            display_name ?? null,
            default_brand_tokens ? JSON.stringify(default_brand_tokens) : null,
            seo_defaults ? JSON.stringify(seo_defaults) : null,
            ctmValue ?? null,
            ctmValue !== undefined,
            analytics_disabled ?? false,
            analytics_disabled !== undefined,
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

        const updated = await pool.query<{
          id: string;
          display_name: string;
          crm_site_id: string | null;
          status: string;
        }>(
          `SELECT id, slug, display_name, status, default_brand_tokens, seo_defaults,
                  ctm_account_id, crm_site_id, analytics_disabled, created_at FROM sites WHERE id = $1`,
          [siteId],
        );
        const site = updated.rows[0];
        res.json({ site });

        // P11-T11.7 (D-053): best-effort CRM sync after PATCH. Detached from
        // the request lifecycle (D102): the response above is already sent,
        // so a failure here must be logged — it can never be allowed to
        // reach next(err) and the (already-responded) error handler.
        void (async () => {
          if (site.crm_site_id && (display_name !== undefined)) {
            const primaryRow = await pool.query<{ hostname: string }>(
              `SELECT hostname FROM site_domains WHERE site_id = $1 AND is_primary = true LIMIT 1`,
              [siteId],
            );
            crmClient.updateSite(site.crm_site_id, {
              name: site.display_name,
              primaryDomain: primaryRow.rows[0]?.hostname,
            }).catch((err) => {
              // eslint-disable-next-line no-console
              console.error("[crm] updateSite failed (best-effort):", err);
              try {
                void getBoss().send(
                  CRM_SYNC_JOB,
                  { action: "update", siteId } satisfies CrmSyncInput,
                  { retryLimit: 3 },
                );
              } catch {
                // Boss not started — skip retry enqueue.
              }
            });
          }
          // Deprovision when site is archived via PATCH status (status not in patchSitePayload yet,
          // but guard here for when it lands — D-053).
          if (site.crm_site_id && site.status === "archived") {
            crmClient.deprovisionSite(site.crm_site_id).catch((err) => {
              // eslint-disable-next-line no-console
              console.error("[crm] deprovisionSite failed (best-effort):", err);
              try {
                void getBoss().send(
                  CRM_SYNC_JOB,
                  { action: "deprovision", siteId } satisfies CrmSyncInput,
                  { retryLimit: 3 },
                );
              } catch {
                // Boss not started — skip retry enqueue.
              }
            });
          }
        })().catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[crm] post-response sync failed (best-effort):", err);
        });
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
