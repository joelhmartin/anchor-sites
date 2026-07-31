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
import { renderPage } from "../render-page.js";
import { loadAssetsForBlocks } from "../render-hydration.js";
import { mintTemplatePreviewToken, templatePreviewQueryAuth } from "../preview-token.js";
import { buildTemplatePreviewHrefResolver } from "../preview-links.js";
import type { ResolvedSite } from "../../middleware/resolveSite.js";

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
          // D702: capture in display order (authored sort_order first) so a
          // site saved as a template preserves the order its pages appear in.
          const rows = await pool.query<SourcePageRow>(
            `SELECT id, slug, title, blocks, seo
               FROM pages
              WHERE site_id = $1
              ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
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
  // `createSiteWithDomains` primitive), then enqueues materialization of the
  // template's pages (D-042). `createSiteWithDomains` ALSO enqueues a
  // `site.provision` job for the canonical hostname (Task D1 auto-
  // provisioning — see docs/deploy.md's "Kinsta DNS provider" section), so
  // the public hostname is no longer a separate explicit /provision step for
  // sites created this way. The UI polls site detail (pages_count) for
  // page-materialization completion; hostname readiness is tracked
  // separately on the domain row's own status fields.
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
        const { siteId, canonical, enqueueProvision } = await createSiteWithDomains(client, {
          slug,
          displayName: display_name,
          brandTokens: brand_tokens,
        });
        await client.query("COMMIT");
        // Final review item 4: same after-commit rule as the materialize
        // enqueue below (and as POST /api/sites) — the provision worker must
        // never see the job before the site row it names.
        await enqueueProvision();

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
  // POST /api/templates/:id/preview-token — mint the short-lived,
  // TEMPLATE-scoped credential the template-preview <iframe> carries in its
  // query string (W1.1). Same design as the site preview-token route
  // (admin-pages.ts): THIS request is a normal SPA fetch (cookies/headers
  // reach it); the iframe it mints for can use neither.
  // -------------------------------------------------------------------------
  router.post(
    "/templates/:id/preview-token",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const found = await getTemplate(req.params.id, { pool });
        if (!found) {
          res.status(404).json({ error: "template not found" });
          return;
        }
        const minted = mintTemplatePreviewToken(req.params.id);
        if (!minted) {
          res.status(503).json({ error: "preview tokens not configured" });
          return;
        }
        res.json({ token: minted.token, expires_at: new Date(minted.expiresAt).toISOString() });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/templates/:id/preview/:pageSlug? — render one of a template's
  // pages as full HTML through the SAME pipeline the site preview uses
  // (renderPage + shell + block CSS), so what the operator previews is what
  // materialize will produce (W1.1 / D701, D205).
  //
  // Why this route exists at all: built-in templates seed with NO
  // `source_site_id` (db/seed-templates.ts INSERTs without the column), so
  // there is no real site to point an iframe at — the template's own
  // `template_pages` blocks are the only source of truth. Rendering them
  // through `renderPage` against a synthetic ResolvedSite (template name as
  // display name, template brand_tokens as the site tokens, analytics/CTM
  // hard-off exactly like the draft preview) reuses the whole existing
  // renderer instead of growing a parallel one.
  //
  // Auth mirrors the site preview route: the sandboxed iframe can send no
  // cookies and set no headers, so `?token=` (template-scoped, 15-min,
  // minted above) or the legacy query-token shim is the whole story.
  // -------------------------------------------------------------------------
  router.get(
    "/templates/:id/preview/:pageSlug?",
    templatePreviewQueryAuth(admin),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const found = await getTemplate(req.params.id, { pool });
        if (!found) {
          res.status(404).json({ error: "template not found" });
          return;
        }
        const { template, pages } = found;
        if (pages.length === 0) {
          res.status(404).json({ error: "template has no pages" });
          return;
        }
        const pageSlug = req.params.pageSlug;
        const tplPage = pageSlug ? pages.find((p) => p.slug === pageSlug) : pages[0];
        if (!tplPage) {
          res.status(404).json({ error: "template page not found" });
          return;
        }

        const site: ResolvedSite = {
          id: template.id,
          slug: template.slug,
          display_name: template.name,
          default_brand_tokens: template.brand_tokens ?? {},
          seo_defaults: {},
          // Never inject tracking into a sandboxed preview (same rule as the
          // site draft preview — see admin-pages.ts).
          ctm_account_id: null,
          analytics_disabled: true,
          matched_via: "domain",
          plugins: [],
        };

        // Captured templates keep their source site's asset_ids; hydrate from
        // that site when it exists. Built-ins have no source site (and no
        // in-page asset_ids), so an empty asset set renders their blocks'
        // designed placeholders.
        const assets = template.source_site_id
          ? await loadAssetsForBlocks(pool, template.source_site_id, tplPage.blocks)
          : [];

        // Same CSP/cache/referrer story as the site draft preview route
        // (admin-pages.ts documents each header at length): sandboxed,
        // script-free, style/img over https+data, never cached, and never
        // leaking the tokened URL via Referer.
        res.setHeader(
          "Content-Security-Policy",
          "sandbox allow-scripts; default-src 'self' https: data:; " +
            "style-src 'unsafe-inline' https: data:; img-src https: data:; " +
            "script-src 'none'; frame-ancestors 'self'",
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");

        const rewriteHref = buildTemplatePreviewHrefResolver({
          templateId: template.id,
          pages,
          query: req.query as Record<string, unknown>,
        });
        const { html } = renderPage(
          site,
          {
            title: tplPage.title,
            blocks: tplPage.blocks ?? [],
            seo: tplPage.seo ?? {},
            brand_tokens_override: null,
          },
          {
            assets,
            path: tplPage.slug === "home" ? "/" : `/${tplPage.slug}`,
            rewriteHref,
          },
        );
        res.status(200).type("html").send(html);
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/materialize-template — re-enqueue materialization
  // for an existing site (W1.1 / D703). The from-template response reports
  // `job:{queued:false,error}` when the enqueue fails after the site was
  // created; this is the retry affordance that failure previously lacked —
  // without it the operator was stranded on a 0-page site with no recourse
  // but recreating it under a new slug.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/materialize-template",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = z.object({ template_id: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload" });
        return;
      }
      const { siteId } = req.params;
      const { template_id } = parsed.data;
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
        if (found.template.kind !== "site") {
          res.status(400).json({ error: "template is not a site template" });
          return;
        }

        let job: { queued: boolean; id?: string | null; error?: string };
        try {
          const r = await enqueueMaterialize({ siteId, templateId: template_id });
          job = { queued: true, id: r.id };
        } catch (e) {
          job = { queued: false, error: e instanceof Error ? e.message : String(e) };
        }
        res.status(job.queued ? 202 : 503).json({ job });
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
