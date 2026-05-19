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
