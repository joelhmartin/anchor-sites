import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import {
  extForContentType,
  signUploadUrl,
  type SignedUploadUrl,
} from "../media/storage.js";
import { MEDIA_PROCESS_UPLOAD } from "../jobs/index.js";
import type { PgBoss } from "pg-boss";
import { searchPixabay } from "../media/pixabay.js";
import { ingestImageFromUrl } from "../media/ingest.js";

/**
 * Media admin API (P3-T3.9 + P3-T3.11).
 *
 *   POST /api/sites/:siteId/media/upload-url
 *     body: { content_type, alt?, focal_point? }
 *     → { asset_id, upload_url, expires_at, headers }
 *
 *   POST /api/sites/:siteId/media/:assetId/complete   (P3-T3.11)
 *     enqueues media.process-upload via pg-boss
 *
 *   POST /api/sites/:siteId/media/stock-search   (Task 8, inline editing)
 *     body: { query, per_page? } → { mode, hits: [{ id, tags, preview,
 *     download_url, width, height, credit }] } — same hit-mapping convention
 *     as the AI agent's search_stock_images tool (tools/assets.ts).
 *
 *   POST /api/sites/:siteId/media/stock-import   (Task 8, inline editing)
 *     body: { url, alt } → 202 { asset_id } — delegates to
 *     ingestImageFromUrl (SSRF/size/timeout guards ride along); guard
 *     rejections surface as 400 invalid-payload responses.
 *
 * All require X-Admin-Token. requireAdmin is applied per-route so
 * unknown /api/* paths fall through to a 404 rather than 401.
 */

const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const uploadUrlPayload = z.object({
  content_type: z
    .string()
    .min(1)
    .regex(/^image\/(jpeg|jpg|png|webp|avif|gif)$/i, "unsupported content_type"),
  alt: z.string().max(500).default(""),
  focal_point: focalPointSchema.optional(),
});

const stockSearchPayload = z.object({
  query: z.string().min(2).max(100),
  per_page: z.number().int().min(1).max(20).optional(),
});

const stockImportPayload = z.object({
  url: z.string().url(),
  alt: z.string().min(3).max(500),
});

export type MediaRouterOptions = {
  pool?: Pool;
  signUpload?: typeof signUploadUrl;
  uploadRateLimit?: RateLimitOptions;
  /**
   * Inject a pg-boss instance (or stub) so the upload-complete callback
   * can enqueue media.process-upload. Defaults to the live `getBoss()`
   * accessor. Tests pass a `{ send }` stub.
   */
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>;
  /** Inject a stock-photo search fn for tests. Defaults to searchPixabay. */
  searchFn?: typeof searchPixabay;
  /** Inject an ingest fn for tests. Defaults to ingestImageFromUrl. */
  ingestFn?: typeof ingestImageFromUrl;
};

export function mediaRouter(opts: MediaRouterOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const sign = opts.signUpload ?? signUploadUrl;
  // Default enqueue resolves the live pg-boss at call time so the router
  // can be constructed before bootJobs completes.
  const enqueue =
    opts.enqueue ??
    (async (name: string, data: unknown) => {
      const { getBoss } = await import("../jobs/index.js");
      const boss: PgBoss = getBoss();
      return boss.send(name, data as Record<string, unknown>);
    });
  const search = opts.searchFn ?? searchPixabay;
  const ingest = opts.ingestFn ?? ingestImageFromUrl;
  const router = Router();

  const admin = requireAdmin();
  const limiter = rateLimit(opts.uploadRateLimit ?? { max: 20, windowMs: 60_000 });

  router.post(
    "/sites/:siteId/media/upload-url",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;

      const parsed = uploadUrlPayload.safeParse(req.body);
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

      const { content_type, alt, focal_point } = parsed.data;
      const ext = extForContentType(content_type);
      if (!ext) {
        res.status(400).json({ error: "unsupported content_type" });
        return;
      }

      try {
        // Verify the site exists; rejects forged siteId before we mint a URL.
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        // D509 (W2-CONC): ONE INSERT with an app-side uuid and the id-derived
        // gcs_key — never the old two-step INSERT-'pending'-then-UPDATE.
        // That shape put a shared magic placeholder into a UNIQUE column:
        // two concurrent upload-url calls collided with unique_violation
        // (500), and a crash between the two statements stranded a
        // 'pending'-keyed row that blocked ALL future uploads platform-wide.
        const assetId = randomUUID();
        const gcsKey = `originals/${siteId}/${assetId}.${ext}`;
        await pool.query(
          `INSERT INTO media_assets (id, site_id, gcs_key, content_type, alt, focal_point)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            assetId,
            siteId,
            gcsKey,
            content_type,
            alt,
            focal_point ? JSON.stringify(focal_point) : null,
          ],
        );

        const signed: SignedUploadUrl = await sign({ gcsKey, contentType: content_type });

        res.status(200).json({
          asset_id: assetId,
          gcs_key: gcsKey,
          ...signed,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/media/:assetId/complete — P3-T3.11
  //
  // Enqueues media.process-upload after the browser PUTs to GCS.
  // Idempotent: if the row is already ready (or freshly processing), returns
  // 202 with current state (no re-enqueue). 404 if the asset isn't owned by
  // the site.
  //
  // D604 (W2-JOBS): 'processing' is NOT unconditionally terminal here. A
  // worker that died mid-processing (SIGTERM on scale-in, crash) leaves the
  // row stuck at 'processing' forever — the handler's catch never ran, so it
  // never reached 'failed', and this route used to refuse re-enqueue for ANY
  // 'processing' row. Treat a STALE processing row (never reached
  // processed_at, and older than the 15-min pg-boss expiry window) as
  // retryable, exactly like the 'failed' branch — otherwise the asset is
  // permanently stuck with no operator affordance.
  // -------------------------------------------------------------------------
  const STALE_PROCESSING_MS = 15 * 60 * 1000;
  router.post(
    "/sites/:siteId/media/:assetId/complete",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, assetId } = req.params;
      try {
        const row = await pool.query<{
          variants_status: string;
          processed_at: string | null;
          created_at: string;
        }>(
          `SELECT variants_status, processed_at, created_at FROM media_assets
            WHERE id = $1 AND site_id = $2`,
          [assetId, siteId],
        );
        if (row.rowCount === 0) {
          res.status(404).json({ error: "media asset not found for this site" });
          return;
        }

        const { variants_status: status, processed_at, created_at } = row.rows[0];
        const isStaleProcessing =
          status === "processing" &&
          processed_at == null &&
          Date.now() - new Date(created_at).getTime() > STALE_PROCESSING_MS;

        // 'ready' is terminal; a FRESH 'processing' row is genuinely in
        // flight — neither re-enqueues. Only a stale-processing (D604) or a
        // pending/failed row falls through to the enqueue below.
        if (status === "ready" || (status === "processing" && !isStaleProcessing)) {
          res.status(202).json({ asset_id: assetId, variants_status: status, enqueued: false });
          return;
        }

        await enqueue(MEDIA_PROCESS_UPLOAD, { asset_id: assetId });
        res.status(202).json({
          asset_id: assetId,
          // Report the actual current status: a stale-processing re-drive is
          // still 'processing' (the handler will re-flip + reprocess), a
          // pending/failed re-enqueue is 'pending'.
          variants_status: isStaleProcessing ? "processing" : "pending",
          enqueued: true,
          ...(isStaleProcessing ? { retried_stale: true } : {}),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/media/stock-search — Task 8 (inline editing)
  //
  // Thin wrapper around searchPixabay for the operator media picker. Hit
  // mapping mirrors the AI agent's search_stock_images tool exactly
  // (tools/assets.ts) so both surfaces speak the same shape.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/media/stock-search",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;

      const parsed = stockSearchPayload.safeParse(req.body);
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

      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        const { query, per_page } = parsed.data;
        const { mode, hits } = await search(query, { perPage: per_page });
        res.status(200).json({
          mode,
          hits: hits.map((h) => ({
            id: h.id,
            tags: h.tags,
            preview: h.previewURL,
            download_url: h.largeImageURL,
            width: h.imageWidth,
            height: h.imageHeight,
            credit: h.user,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sites/:siteId/media/stock-import — Task 8 (inline editing)
  //
  // Delegates to ingestImageFromUrl, which carries its own SSRF/size/timeout
  // guards (media/ingest.ts). A guard rejection throws a plain Error — caught
  // here and surfaced as a 400 invalid-payload response (same shape as a
  // failed zod parse) rather than a 500, since it's the caller-supplied url
  // that's at fault.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/media/stock-import",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;

      const parsed = stockImportPayload.safeParse(req.body);
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

      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        const { url, alt } = parsed.data;
        try {
          const result = await ingest(pool, { siteId, url, alt });
          res.status(202).json({ asset_id: result.asset_id });
        } catch (guardErr) {
          res.status(400).json({
            error: "invalid payload",
            details: [
              {
                path: "url",
                message: guardErr instanceof Error ? guardErr.message : "image import failed",
              },
            ],
          });
        }
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
