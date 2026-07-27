import type { Pool } from "pg";
import { getStorage, MEDIA_BUCKET, extForContentType } from "./storage.js";
import { MEDIA_PROCESS_UPLOAD } from "../jobs/index.js";

/**
 * Server-side ingest for the AI agent: fetch an image URL and land it in the
 * standard media pipeline (asset row → GCS original → variants job) — the
 * same shape the browser signed-URL flow produces (src/server/routes/media.ts
 * :106-123), so hydration Just Works.
 *
 * Download happens BEFORE the insert so a failed fetch leaves no orphan row.
 */

export type IngestDeps = {
  fetchFn?: typeof fetch;
  storage?: ReturnType<typeof getStorage>;
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>;
};

export async function ingestImageFromUrl(
  pool: Pool,
  input: { siteId: string; url: string; alt: string; contentType?: string },
  deps: IngestDeps = {},
): Promise<{ asset_id: string; gcs_key: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const res = await fetchFn(input.url);
  if (!res.ok) {
    throw new Error(`image download failed: ${res.status} for ${input.url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType =
    input.contentType ?? res.headers?.get?.("content-type") ?? "application/octet-stream";
  const ext = extForContentType(contentType);
  if (!ext) {
    throw new Error(`unsupported image content-type: ${contentType}`);
  }

  // Mirrors the media.ts route insert (site_id, gcs_key placeholder,
  // content_type, alt, focal_point) — alt is NOT NULL in the schema, and
  // focal_point is nullable jsonb (the agent never picks one).
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, focal_point)
     VALUES ($1, 'pending', $2, $3, NULL)
     RETURNING id`,
    [input.siteId, contentType, input.alt],
  );
  const assetId = ins.rows[0].id;
  const gcsKey = `originals/${input.siteId}/${assetId}.${ext}`;

  // Replace the placeholder gcs_key now that we know the asset id (same
  // two-step pattern as the route: insert, then fill in the id-derived key).
  await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

  const storage = deps.storage ?? getStorage();
  await storage
    .bucket(MEDIA_BUCKET)
    .file(gcsKey)
    .save(buf, {
      metadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      resumable: false,
    });

  const enqueue =
    deps.enqueue ??
    (async (name: string, data: unknown) => {
      // Lazy import + try/catch: getBoss() throws when bootJobs hasn't run
      // (tests, JOBS_ENABLED=false) — mirror routes/media.ts + create-site.ts.
      try {
        const { getBoss } = await import("../jobs/index.js");
        return await getBoss().send(name, data as Record<string, unknown>);
      } catch {
        return null;
      }
    });
  await enqueue(MEDIA_PROCESS_UPLOAD, { asset_id: assetId });

  return { asset_id: assetId, gcs_key: gcsKey };
}
