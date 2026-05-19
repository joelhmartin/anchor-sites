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
 * Both require X-Admin-Token. requireAdmin is applied per-route so
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

        const ins = await pool.query<{ id: string }>(
          `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, focal_point)
           VALUES ($1, 'pending', $2, $3, $4::jsonb)
           RETURNING id`,
          [
            siteId,
            content_type,
            alt,
            focal_point ? JSON.stringify(focal_point) : null,
          ],
        );
        const assetId = ins.rows[0].id;
        const gcsKey = `originals/${siteId}/${assetId}.${ext}`;

        // Replace the placeholder gcs_key now that we know the asset id.
        await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

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
  // Idempotent: if the row is already processing or ready, returns 202 with
  // current state (no re-enqueue). 404 if the asset isn't owned by the site.
  // -------------------------------------------------------------------------
  router.post(
    "/sites/:siteId/media/:assetId/complete",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId, assetId } = req.params;
      try {
        const row = await pool.query<{ variants_status: string }>(
          `SELECT variants_status FROM media_assets
            WHERE id = $1 AND site_id = $2`,
          [assetId, siteId],
        );
        if (row.rowCount === 0) {
          res.status(404).json({ error: "media asset not found for this site" });
          return;
        }

        const status = row.rows[0].variants_status;
        if (status === "processing" || status === "ready") {
          res.status(202).json({ asset_id: assetId, variants_status: status, enqueued: false });
          return;
        }

        await enqueue(MEDIA_PROCESS_UPLOAD, { asset_id: assetId });
        res.status(202).json({ asset_id: assetId, variants_status: "pending", enqueued: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
