import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import {
  createTemplate,
  listTemplates,
  getTemplate,
  archiveTemplate,
  TemplateValidationError,
  TemplateSlugConflictError,
} from "../templates/repo.js";
import { templateKindSchema, templateStatusSchema } from "../templates/schema.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
import { createSiteWithDomains, SiteSlugConflictError } from "../sites/create-site.js";
import { getBoss, TEMPLATE_MATERIALIZE } from "../jobs/index.js";
import type { Block } from "../../blocks/types.js";

/** Enqueue a template-materialization job. Injectable so tests stub pg-boss. */
export type MaterializeEnqueue = (input: {
  siteId: string;
  templateId: string;
}) => Promise<{ id: string | null }>;

/**
 * Template HTTP surface (Phase 7). Save a site (or page, 7.9) as a reusable
 * template; list/inspect/archive templates (7.4); create a site or page from a
 * template (7.6/7.9). Mounted at `/api`, gated per-route by `requireAdmin`.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Derive a valid template slug from a free-text name. Falls back to "template". */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SLUG_RE.test(base) ? base : "template";
}

const saveAsTemplatePayload = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen").optional(),
  /** Which pages to capture. Omit to capture every page on the site. */
  page_ids: z.array(z.string().uuid()).optional(),
  /** Capture the site's default brand tokens into the template (default true). */
  include_brand_tokens: z.boolean().default(true),
  /** Gallery grouping label (e.g. "Basic"). Optional — defaults to null. */
  category: z.string().max(100).nullable().optional(),
  /** Gallery card thumbnail URL. Optional — defaults to null. */
  cover_image_url: z.string().url().max(2000).nullable().optional(),
  /** Gallery display order (ascending). Optional — defaults to 0. */
  sort_order: z.number().int().optional(),
});

type SourcePageRow = {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
  seo: Record<string, unknown>;
};

const savePageAsTemplatePayload = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen").optional(),
  /** Gallery grouping label (e.g. "Basic"). Optional — defaults to null. */
  category: z.string().max(100).nullable().optional(),
  /** Gallery card thumbnail URL. Optional — defaults to null. */
  cover_image_url: z.string().url().max(2000).nullable().optional(),
  /** Gallery display order (ascending). Optional — defaults to 0. */
  sort_order: z.number().int().optional(),
});

const pageFromTemplatePayload = z.object({
  template_id: z.string().uuid(),
  /** Slug for the new page; defaults to the template page's slug. */
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen").optional(),
  title: z.string().min(1).max(200).optional(),
});

const fromTemplatePayload = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase a-z, 0-9, hyphen; no leading/trailing hyphen"),
  display_name: z.string().min(1).max(200),
  template_id: z.string().uuid(),
  /** Optional brand tokens for the new site. When omitted, the materialization
   * job adopts the template's tokens (D-042). */
  brand_tokens: brandTokensSchema.optional(),
});

export type TemplatesRouterOptions = {
  pool?: Pool;
  saveRateLimit?: RateLimitOptions;
  /** Override the materialization enqueue (tests stub pg-boss). */
  enqueueMaterialize?: MaterializeEnqueue;
};

export function templatesRouter(opts: TemplatesRouterOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();
  const saveLimiter = rateLimit(opts.saveRateLimit ?? { max: 20, windowMs: 60_000 });

  // Default enqueue → pg-boss, deduped per (site, template) so a double-submit
  // doesn't run materialization twice (D-042). getBoss() is called lazily at
  // request time so importing this module never requires a booted worker.
  const enqueueMaterialize: MaterializeEnqueue =
    opts.enqueueMaterialize ??
    (async ({ siteId, templateId }) => {
      const id = await getBoss().send(
        TEMPLATE_MATERIALIZE,
        { siteId, templateId },
        { singletonKey: `${siteId}:${templateId}` },
      );
      return { id };
    });

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/save-as-template — capture a site as a reusable
  // template (P7-T7.3). Snapshots selected pages' slug/title/blocks/seo and
  // (optionally) the site's default brand tokens. Re-validates every captured
  // page's blocks via the shared registry validator (D-039) → 422 on failure.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/save-as-template",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = saveAsTemplatePayload.safeParse(req.body);
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
      const { name, description, include_brand_tokens, category, cover_image_url, sort_order } = parsed.data;
      const slug = parsed.data.slug ?? slugifyName(name);

      try {
        const siteRes = await pool.query<{ default_brand_tokens: Record<string, string> }>(
          `SELECT default_brand_tokens FROM sites WHERE id = $1`,
          [siteId],
        );
        if (siteRes.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        // Capture pages. When page_ids is given, preserve that order and
        // require every id to belong to this site; otherwise capture all.
        let pages: SourcePageRow[];
        if (parsed.data.page_ids && parsed.data.page_ids.length > 0) {
          const ids = parsed.data.page_ids;
          const rows = await pool.query<SourcePageRow>(
            `SELECT id, slug, title, blocks, seo
               FROM pages
              WHERE site_id = $1 AND id = ANY($2::uuid[])`,
            [siteId, ids],
          );
          if (rows.rowCount !== ids.length) {
            res.status(400).json({ error: "page_ids contains pages that are not on this site" });
            return;
          }
          const byId = new Map(rows.rows.map((r) => [r.id, r]));
          pages = ids.map((id) => byId.get(id)!);
        } else {
          const rows = await pool.query<SourcePageRow>(
            `SELECT id, slug, title, blocks, seo
               FROM pages
              WHERE site_id = $1
              ORDER BY created_at ASC`,
            [siteId],
          );
          pages = rows.rows;
        }

        const { template, pages: templatePages } = await createTemplate(
          {
            slug,
            name,
            description,
            kind: "site",
            source_site_id: siteId,
            brand_tokens: include_brand_tokens ? siteRes.rows[0].default_brand_tokens : {},
            category: category ?? null,
            cover_image_url: cover_image_url ?? null,
            sort_order: sort_order ?? 0,
            pages: pages.map((p) => ({
              slug: p.slug,
              title: p.title,
              blocks: p.blocks ?? [],
              seo: p.seo ?? {},
            })),
          },
          { pool },
        );

        res.status(201).json({
          template: { ...template, pages_count: templatePages.length },
        });
      } catch (err) {
        if (err instanceof TemplateSlugConflictError) {
          res.status(409).json({ error: "a template with that slug already exists", slug: err.slug });
          return;
        }
        if (err instanceof TemplateValidationError) {
          res.status(422).json({ error: "template block validation failed", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId/save-as-template — capture ONE page
  // as a reusable `kind:'page'` template (no brand tokens). (P7-T7.9)
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId/save-as-template",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = savePageAsTemplatePayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message })),
        });
        return;
      }
      const { siteId, pageId } = req.params;
      const { name, description, category, cover_image_url, sort_order } = parsed.data;
      const slug = parsed.data.slug ?? slugifyName(name);

      try {
        const pageRes = await pool.query<{ slug: string; title: string; blocks: Block[]; seo: Record<string, unknown> }>(
          `SELECT slug, title, blocks, seo FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (pageRes.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }
        const page = pageRes.rows[0];

        const { template } = await createTemplate(
          {
            slug,
            name,
            description,
            kind: "page",
            source_site_id: siteId,
            category: category ?? null,
            cover_image_url: cover_image_url ?? null,
            sort_order: sort_order ?? 0,
            pages: [{ slug: page.slug, title: page.title, blocks: page.blocks ?? [], seo: page.seo ?? {} }],
          },
          { pool },
        );
        res.status(201).json({ template });
      } catch (err) {
        if (err instanceof TemplateSlugConflictError) {
          res.status(409).json({ error: "a template with that slug already exists", slug: err.slug });
          return;
        }
        if (err instanceof TemplateValidationError) {
          res.status(422).json({ error: "template block validation failed", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/from-template — insert a `kind:'page'`
  // template's single page into an existing site. Synchronous (one page, no
  // job): writes the page + an 'import' revision; 409 on slug collision.
  // (P7-T7.9)
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/from-template",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = pageFromTemplatePayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message })),
        });
        return;
      }
      const { siteId } = req.params;
      const { template_id, slug: slugOverride, title: titleOverride } = parsed.data;

      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const found = await getTemplate(template_id, { pool });
        if (!found) {
          res.status(404).json({ error: "template not found" });
          return;
        }
        if (found.template.kind !== "page") {
          res.status(400).json({ error: "template is not a page template" });
          return;
        }
        if (found.template.status !== "active") {
          res.status(400).json({ error: "template is archived" });
          return;
        }
        const tplPage = found.pages[0];
        if (!tplPage) {
          res.status(400).json({ error: "template has no page to insert" });
          return;
        }
        const slug = slugOverride ?? tplPage.slug;
        const title = titleOverride ?? tplPage.title;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const ins = await client.query<{ id: string }>(
            `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'draft')
             ON CONFLICT (site_id, slug) DO NOTHING
             RETURNING id`,
            [siteId, slug, title, JSON.stringify(tplPage.blocks ?? []), JSON.stringify(tplPage.seo ?? {})],
          );
          if (ins.rowCount === 0) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: "a page with that slug already exists on this site" });
            return;
          }
          const pageId = ins.rows[0].id;
          await client.query(
            `INSERT INTO page_revisions (page_id, blocks, seo, source)
             VALUES ($1, $2::jsonb, $3::jsonb, 'import')`,
            [pageId, JSON.stringify(tplPage.blocks ?? []), JSON.stringify(tplPage.seo ?? {})],
          );
          await client.query("COMMIT");
          res.status(201).json({ page: { id: pageId, site_id: siteId, slug, title, status: "draft" } });
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/from-template — create a new site from a site template
  // (P7-T7.6). Creates the site + canonical domains (reusing the shared
  // primitive), then enqueues materialization of the template's pages (D-042).
  // Does NOT provision the public hostname — that stays the explicit
  // /provision step. The UI polls site detail (pages_count) for completion.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/from-template",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = fromTemplatePayload.safeParse(req.body);
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
      const { slug, display_name, template_id, brand_tokens } = parsed.data;

      const found = await getTemplate(template_id, { pool }).catch((err) => {
        next(err);
        return undefined;
      });
      if (res.headersSent) return;
      if (!found) {
        res.status(404).json({ error: "template not found" });
        return;
      }
      if (found.template.kind !== "site") {
        res.status(400).json({ error: "template is not a site template" });
        return;
      }
      if (found.template.status !== "active") {
        res.status(400).json({ error: "template is archived" });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { siteId, canonical } = await createSiteWithDomains(client, {
          slug,
          displayName: display_name,
          brandTokens: brand_tokens,
        });
        await client.query("COMMIT");

        // Enqueue after commit so the job sees the committed site. Best-effort:
        // the site exists regardless; a failed enqueue is reported so the
        // operator can retry rather than losing the created site.
        let job: { queued: boolean; id?: string | null; error?: string };
        try {
          const r = await enqueueMaterialize({ siteId, templateId: template_id });
          job = { queued: true, id: r.id };
        } catch (e) {
          job = { queued: false, error: e instanceof Error ? e.message : String(e) };
        }

        res.status(201).json({
          site: {
            id: siteId,
            slug,
            display_name,
            status: "active",
            default_brand_tokens: brand_tokens ?? {},
            canonical_hostname: canonical,
          },
          template_id,
          job,
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

  // -------------------------------------------------------------------------
  // GET /api/templates — list templates (gallery order: sort_order asc, then
  // name) with pages_count.
  // Optional filters: ?kind=site|page, ?status=active|archived (default active).
  // (P7-T7.4)
  // -------------------------------------------------------------------------
  router.get(
    "/templates",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const kindParse = templateKindSchema.safeParse(req.query.kind);
      const statusParse = templateStatusSchema.safeParse(req.query.status);
      try {
        const templates = await listTemplates({
          pool,
          kind: kindParse.success ? kindParse.data : undefined,
          status: statusParse.success ? statusParse.data : "active",
        });
        res.json({ templates });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/templates/:id — one template with its ordered pages. (P7-T7.4)
  // -------------------------------------------------------------------------
  router.get(
    "/templates/:id",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const found = await getTemplate(req.params.id, { pool });
        if (!found) {
          res.status(404).json({ error: "template not found" });
          return;
        }
        res.json(found);
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/templates/:id — archive (soft delete; D-041 never hard-deletes).
  // Idempotent. (P7-T7.4)
  // -------------------------------------------------------------------------
  router.delete(
    "/templates/:id",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const archived = await archiveTemplate(req.params.id, { pool });
        if (!archived) {
          res.status(404).json({ error: "template not found" });
          return;
        }
        res.json({ template: archived });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
