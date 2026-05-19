import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Pool } from "pg";
import { getStorage, MEDIA_BUCKET } from "../media/storage.js";
import {
  VARIANT_FORMATS,
  VARIANT_WIDTHS,
  variantGcsKey,
  variantPublicUrl,
  type ProcessedVariant,
  type VariantFormat,
  type VariantName,
} from "../media/variant-spec.js";

/**
 * pg-boss handler for `media.process-upload` (P3-T3.10 / D-031).
 *
 * Flow: pending → processing → ready (or failed). On failure, pg-boss
 * retries via its built-in backoff; the handler is idempotent because
 * variant URLs are content-hashed and uploads use `if-generation-match`
 * not at the GCS-API level — re-running the job just overwrites with
 * identical bytes at the same key.
 */

export type MediaProcessUploadInput = {
  asset_id: string;
};

export type MediaProcessUploadDeps = {
  pool: Pool;
  bucket?: string;
  /** Override the GCS client for tests. */
  storage?: ReturnType<typeof getStorage>;
};

export async function handleMediaProcessUpload(
  data: MediaProcessUploadInput,
  deps: MediaProcessUploadDeps,
): Promise<{ asset_id: string; variants: ProcessedVariant[] }> {
  const { asset_id } = data;
  const pool = deps.pool;
  const bucket = deps.bucket ?? MEDIA_BUCKET;
  const storage = deps.storage ?? getStorage();

  const row = await pool.query<{
    id: string;
    site_id: string;
    gcs_key: string;
    content_type: string;
    variants_status: string;
  }>(
    `SELECT id, site_id, gcs_key, content_type, variants_status
       FROM media_assets WHERE id = $1`,
    [asset_id],
  );
  if (row.rowCount === 0) {
    throw new Error(`media_assets row not found: ${asset_id}`);
  }
  const asset = row.rows[0];

  // Idempotency: if already ready, no-op return. If processing, let it
  // continue — pg-boss prevents concurrent handlers per job id.
  if (asset.variants_status === "ready") {
    const existing = await pool.query<{ variants: ProcessedVariant[] }>(
      `SELECT variants FROM media_assets WHERE id = $1`,
      [asset_id],
    );
    return { asset_id, variants: existing.rows[0].variants ?? [] };
  }

  await pool.query(
    `UPDATE media_assets SET variants_status = 'processing', last_error = NULL WHERE id = $1`,
    [asset_id],
  );

  try {
    // Download the original.
    const [buffer] = await storage.bucket(bucket).file(asset.gcs_key).download();
    const meta = await sharp(buffer).metadata();
    const srcWidth = meta.width ?? 0;
    const srcHeight = meta.height ?? 0;

    const variants: ProcessedVariant[] = [];
    for (const [name, targetW] of Object.entries(VARIANT_WIDTHS) as Array<[VariantName, number]>) {
      // Skip upscaling — if the source is smaller, cap at source width.
      const w = Math.min(targetW, srcWidth || targetW);
      for (const format of VARIANT_FORMATS) {
        const out = await renderVariant(buffer, w, format);
        const hash = shortHash(out.body);
        const gcsKey = variantGcsKey({
          siteId: asset.site_id,
          assetId: asset_id,
          variant: name,
          hash,
          format,
        });
        await storage
          .bucket(bucket)
          .file(gcsKey)
          .save(out.body, {
            metadata: {
              contentType: out.contentType,
              cacheControl: "public, max-age=31536000, immutable",
            },
            // Bucket has uniform-bucket-level access; per-object ACL is
            // ignored. Public visibility is granted via IAM elsewhere.
            resumable: false,
          });
        variants.push({
          name,
          format,
          width: out.width,
          height: out.height,
          url: variantPublicUrl({
            bucket,
            siteId: asset.site_id,
            assetId: asset_id,
            variant: name,
            hash,
            format,
          }),
          bytes: out.body.length,
        });
      }
    }

    await pool.query(
      `UPDATE media_assets
          SET variants = $1::jsonb,
              variants_status = 'ready',
              width = $2,
              height = $3,
              original_bytes = $4,
              processed_at = now(),
              last_error = NULL
        WHERE id = $5`,
      [JSON.stringify(variants), srcWidth, srcHeight, buffer.length, asset_id],
    );

    return { asset_id, variants };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE media_assets
          SET variants_status = 'failed', last_error = $1
        WHERE id = $2`,
      [msg, asset_id],
    );
    // Rethrow so pg-boss records the failure + retries per policy.
    throw err;
  }
}

async function renderVariant(
  source: Buffer,
  width: number,
  format: VariantFormat,
): Promise<{ body: Buffer; contentType: string; width: number; height: number }> {
  let pipeline = sharp(source).resize({ width, withoutEnlargement: true });
  if (format === "webp") {
    pipeline = pipeline.webp({ quality: 82 });
  } else {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    body: data,
    contentType: format === "webp" ? "image/webp" : "image/jpeg",
    width: info.width,
    height: info.height,
  };
}

function shortHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 10);
}
