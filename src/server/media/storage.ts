import { Storage } from "@google-cloud/storage";

/**
 * GCS client wiring for the media pipeline (P3-T3.9 / D-031).
 *
 * Storage client is lazily constructed at first use. In prod / dev with
 * a real GCP project, it auto-discovers Application Default Credentials.
 * Tests inject a fake via `setStorageClient(...)`.
 */

export const MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? "anchorcorps-media";

let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

/** Test-only override. Resets the client so the next call uses the override. */
export function __setStorageForTests(client: Storage | null): void {
  _storage = client;
}

export type SignedUploadUrl = {
  upload_url: string;
  expires_at: string;
  headers: Record<string, string>;
};

/**
 * Mint a v4 signed PUT URL for a fresh original. The browser sends the
 * file directly to GCS so bytes never pass through Cloud Run.
 *
 * `gcsKey` follows the layout `originals/<site_id>/<asset_id>.<ext>`
 * (see docs/media-pipeline.md). `contentType` is enforced — the browser
 * MUST send the same `Content-Type` header.
 */
export async function signUploadUrl(args: {
  gcsKey: string;
  contentType: string;
  expiresMs?: number;
}): Promise<SignedUploadUrl> {
  const { gcsKey, contentType } = args;
  const expiresMs = args.expiresMs ?? 15 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiresMs);

  const file = getStorage().bucket(MEDIA_BUCKET).file(gcsKey);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: expiresAt,
    contentType,
  });

  return {
    upload_url: url,
    expires_at: expiresAt.toISOString(),
    headers: { "Content-Type": contentType },
  };
}

/**
 * D1016 (W2-TERM) — the deletion story for stored bytes. Nothing removed GCS
 * objects anywhere, so originals + variants accreted forever (including the
 * orphans D1015's failed uploads leave behind). This is the low-level
 * primitive the media-delete route, the pending-row sweep (D510), and the
 * orphan GC (D513) all reuse.
 *
 * A media asset owns two object families, both keyed by `<siteId>/<assetId>`:
 *   - the ONE original at `originals/<siteId>/<assetId>.<ext>` (`gcsKey`)
 *   - N processed variants at `variants/<siteId>/<assetId>-<variant>.<hash>.<fmt>`
 *
 * We delete the original by its exact key and the variants by prefix (so
 * every hash/format/variant is swept without reconstructing each key from the
 * `variants` JSON — which may be empty for a pending/failed asset that never
 * processed). `ignoreNotFound` throughout: a missing object (never-uploaded
 * pending row, a partially-processed asset) is success, not an error — the
 * goal is "no bytes remain", which a missing object already satisfies.
 */
export async function deleteAssetObjects(args: {
  gcsKey: string;
  siteId: string;
  assetId: string;
  bucket?: string;
}): Promise<void> {
  const bucketName = args.bucket ?? MEDIA_BUCKET;
  const bucket = getStorage().bucket(bucketName);
  await bucket.file(args.gcsKey).delete({ ignoreNotFound: true });
  await bucket.deleteFiles({ prefix: `variants/${args.siteId}/${args.assetId}-`, force: true });
}

/** Does a single object exist? Used by the pending-row sweep (D510) to tell an
 *  abandoned upload (no object) apart from a slow-but-real one. */
export async function objectExists(gcsKey: string, bucket?: string): Promise<boolean> {
  const bucketName = bucket ?? MEDIA_BUCKET;
  const [exists] = await getStorage().bucket(bucketName).file(gcsKey).exists();
  return exists;
}

/** Maps a content_type to the canonical file extension we'll store. */
export function extForContentType(ct: string): string | null {
  switch (ct.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}
