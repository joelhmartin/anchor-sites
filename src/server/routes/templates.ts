import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import {
  createTemplate,
  TemplateValidationError,
  TemplateSlugConflictError,
} from "../templates/repo.js";
import type { Block } from "../../blocks/types.js";

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
});

type SourcePageRow = {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
  seo: Record<string, unknown>;
};

export type TemplatesRouterOptions = {
  pool?: Pool;
  saveRateLimit?: RateLimitOptions;
};

export function templatesRouter(opts: TemplatesRouterOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();
  const saveLimiter = rateLimit(opts.saveRateLimit ?? { max: 20, windowMs: 60_000 });

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
      const { name, description, include_brand_tokens } = parsed.data;
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

  return router;
}
