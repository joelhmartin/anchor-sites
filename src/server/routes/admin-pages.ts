import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { getBlock } from "../../blocks/registry.js";
import { provisionSiteHostname, siteIdFromSlug } from "../provisioning/orchestrator.js";
import { brandTokensSchema } from "../../blocks/brand-tokens.js";
// Side-effect: register the three static block types so saves validate.
import "../../blocks/index.js";

const blockShape = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.unknown()).default({}),
  children: z.array(z.unknown()).optional(),
});

const savePayload = z.object({
  blocks: z.array(blockShape),
  seo: z.record(z.unknown()).optional(),
  source: z.string().max(64).optional(),
  // P3-T3.5: per-page brand-token override. `null` clears any existing
  // override; omitting the key leaves the column unchanged.
  brand_tokens_override: brandTokensSchema.nullable().optional(),
  // P5-T5.10: publish/draft toggle. Omitting leaves status unchanged.
  status: z.enum(["draft", "published"]).optional(),
});

type SavePayload = z.infer<typeof savePayload>;
type BlockShape = z.infer<typeof blockShape>;

type ValidationFailure = {
  index: number;
  id: string;
  type: string;
  reason: "unknown_type" | "invalid_props";
  errors?: { path: string; message: string }[];
};

function validateBlocks(blocks: BlockShape[]): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  blocks.forEach((block, index) => {
    const entry = getBlock(block.type);
    if (!entry) {
      failures.push({ index, id: block.id, type: block.type, reason: "unknown_type" });
      return;
    }
    const parsed = entry.schema.safeParse(block.props);
    if (!parsed.success) {
      failures.push({
        index,
        id: block.id,
        type: block.type,
        reason: "invalid_props",
        errors: parsed.error.errors.map((e) => ({
          path: e.path.join(".") || "(root)",
          message: e.message,
        })),
      });
    }
  });
  return failures;
}

export type AdminPagesOptions = {
  pool?: Pool;
  /** Override the save rate limit for tests. Default 10/min. */
  saveRateLimit?: RateLimitOptions;
};

export function adminPagesRouter(opts: AdminPagesOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  const saveLimiter = rateLimit(
    opts.saveRateLimit ?? { max: 10, windowMs: 60_000 },
  );

  // requireAdmin is applied per-route (not router-level) so unmatched /api/*
  // paths fall through to Express's default 404 instead of returning 401.
  const admin = requireAdmin();

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId — save blocks + seo, write revision
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;

      const parsed = savePayload.safeParse(req.body);
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

      const payload: SavePayload = parsed.data;
      const failures = validateBlocks(payload.blocks);
      if (failures.length > 0) {
        res.status(400).json({ error: "block validation failed", failures });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // brand_tokens_override semantics: undefined → leave column,
        // null → clear column, object → set column. We pass a sentinel to
        // the SQL CASE so all three branches stay in one round-trip.
        const btoMode =
          payload.brand_tokens_override === undefined
            ? "unchanged"
            : payload.brand_tokens_override === null
              ? "clear"
              : "set";
        const btoValue =
          payload.brand_tokens_override && typeof payload.brand_tokens_override === "object"
            ? JSON.stringify(payload.brand_tokens_override)
            : null;

        const pageRes = await client.query<{ id: string; status: string }>(
          `UPDATE pages
              SET blocks = $1::jsonb,
                  seo = COALESCE($2::jsonb, seo),
                  brand_tokens_override = CASE $5
                    WHEN 'unchanged' THEN brand_tokens_override
                    WHEN 'clear'     THEN NULL
                    WHEN 'set'       THEN $6::jsonb
                  END,
                  status = COALESCE($7, status)
            WHERE id = $3 AND site_id = $4
            RETURNING id, status`,
          [
            JSON.stringify(payload.blocks),
            payload.seo ? JSON.stringify(payload.seo) : null,
            pageId,
            siteId,
            btoMode,
            btoValue,
            payload.status ?? null,
          ],
        );

        if (pageRes.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const revRes = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, $4)
           RETURNING id, created_at`,
          [
            pageId,
            JSON.stringify(payload.blocks),
            JSON.stringify(payload.seo ?? {}),
            payload.source ?? "manual",
          ],
        );

        await client.query("COMMIT");

        res.status(200).json({
          page: {
            id: pageId,
            site_id: siteId,
            blocks: payload.blocks,
            seo: payload.seo ?? {},
            status: pageRes.rows[0].status,
          },
          revision: { id: revRes.rows[0].id, created_at: revRes.rows[0].created_at },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sites/:siteId/pages/:pageId — single page with blocks + seo.
  // The visual editor (P5-T5.5) loads a page's current blocks from here; the
  // pages-list endpoint (admin-sites) deliberately omits blocks for size.
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/pages/:pageId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, pageId } = req.params;
        const result = await pool.query(
          `SELECT id, site_id, slug, title, status, blocks, seo,
                  brand_tokens_override, updated_at
             FROM pages
            WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (result.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }
        res.json({ page: result.rows[0] });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sites/:siteId/pages/:pageId/revisions — reverse-chrono list
  // -------------------------------------------------------------------------
  router.get(
    "/sites/:siteId/pages/:pageId/revisions",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId } = req.params;
      try {
        const pageOk = await pool.query(
          `SELECT 1 FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (pageOk.rowCount === 0) {
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const revs = await pool.query(
          `SELECT id, created_at, source, author_id
             FROM page_revisions
            WHERE page_id = $1
         ORDER BY created_at DESC, id DESC`,
          [pageId],
        );
        res.status(200).json({ revisions: revs.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/pages/:pageId/revisions/:revisionId/restore
  // Non-destructive: copies the revision into pages.blocks/seo AND inserts a
  // new page_revisions row (so revision history is append-only).
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/pages/:pageId/revisions/:revisionId/restore",
    admin,
    saveLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, pageId, revisionId } = req.params;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const revRes = await client.query<{ blocks: BlockShape[]; seo: Record<string, unknown> }>(
          `SELECT blocks, seo
             FROM page_revisions
            WHERE id = $1 AND page_id = $2`,
          [revisionId, pageId],
        );
        if (revRes.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "revision not found for this page" });
          return;
        }

        const ownerOk = await client.query(
          `SELECT 1 FROM pages WHERE id = $1 AND site_id = $2`,
          [pageId, siteId],
        );
        if (ownerOk.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "page not found for this site" });
          return;
        }

        const { blocks, seo } = revRes.rows[0];

        await client.query(
          `UPDATE pages SET blocks = $1::jsonb, seo = $2::jsonb WHERE id = $3`,
          [JSON.stringify(blocks), JSON.stringify(seo ?? {}), pageId],
        );

        const newRev = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, $4)
           RETURNING id, created_at`,
          [pageId, JSON.stringify(blocks), JSON.stringify(seo ?? {}), `restore:${revisionId}`],
        );

        await client.query("COMMIT");
        res.status(200).json({
          restored_from: revisionId,
          revision: { id: newRev.rows[0].id, created_at: newRev.rows[0].created_at },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(err);
      } finally {
        client.release();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/provision — add Kinsta CNAME + Cloud Run mapping
  // POST /api/sites/provision         — same, but take slug in body
  // -------------------------------------------------------------------------
  // Long-running (cert wait can take 20+ min) → not behind the save limiter.
  // Caller controls `wait` via the body.
  const provisionHandler = async (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as { slug?: string; wait?: boolean };
    const wait = Boolean(body.wait);
    try {
      let siteId = req.params.siteId;
      if (!siteId) {
        if (!body.slug) {
          res.status(400).json({ error: "must supply siteId in path or slug in body" });
          return;
        }
        siteId = await siteIdFromSlug(body.slug, pool);
      }
      const result = await provisionSiteHostname(siteId, { pool, wait });
      const httpStatus = result.steps.some((s) => s.status === "error") ? 500 : 200;
      res.status(httpStatus).json(result);
    } catch (err) {
      next(err);
    }
  };
  router.post("/sites/:siteId/provision", admin, provisionHandler);
  router.post("/sites/provision", admin, provisionHandler);

  return router;
}
