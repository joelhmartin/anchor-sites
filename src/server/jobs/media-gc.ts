import type { Pool } from "pg";
import { deleteAssetObjects, objectExists as gcsObjectExists, MEDIA_BUCKET } from "../media/storage.js";

/**
 * W2-TERM media garbage collection — two scheduled sweeps that give stored
 * bytes a deletion story (D1016) and stop the media table from accreting
 * forever. Both follow the auth-prune / domain-verify-sweep cron pattern
 * (see jobs/index.ts): least machinery that ACTUALLY runs given W1.4's
 * `--min-instances=1`, idempotent, one console line only when they act.
 *
 *  - D510 `sweepAbandonedUploads`: a media_assets row is minted at
 *    upload-url time BEFORE the browser PUTs to GCS. A browser that never
 *    PUTs / never calls /complete (or an ingest whose storage.save failed —
 *    D1015 marks those 'failed') leaves a row whose gcs_key names no object,
 *    stuck 'pending'/'failed' forever with no reaper. This deletes such rows
 *    once they're older than PENDING_MAX_AGE_HOURS *and* confirmed to have no
 *    GCS object — the object check is what makes it safe: a slow-but-real
 *    upload whose object already landed is never swept (its /complete can
 *    still process it).
 *
 *  - D513 `sweepOrphanAssets`: unreferenced assets accrete (the seed-templates
 *    header itself documents cover re-ingest piling up rows). Two stages:
 *      MARK    — a READY asset that no page/seo references, older than
 *                ORPHAN_MARK_DAYS, on an ordinary site, gets archived
 *                (archived_at set) — the same terminal state the operator's
 *                media-delete uses.
 *      RECLAIM — an ARCHIVED asset still unreferenced ORPHAN_RECLAIM_DAYS
 *                after archival gets its GCS objects + row hard-deleted.
 *    The recovery window between the two stages means an accidental archive
 *    (operator or MARK) is restorable before any bytes are destroyed.
 *
 * "Referenced" is a UUID text-contains scan (the asset id appearing anywhere
 * in a page's blocks/seo/published_snapshot, the site's seo_defaults, or a
 * deleted_pages tombstone). Text-contains — not the `/asset_id$/i` block
 * scanner — deliberately: that scanner misses SEO's camelCase
 * `ogImageAssetId`, and a bare UUID substring match has no realistic false
 * positives while catching every key shape, current or future.
 *
 * SAFETY EXCLUSIONS (never GC'd): system sites (is_system — their assets are
 * template-gallery covers referenced by URL, not by asset id, so the scan
 * can't see them), and template SOURCE sites (materialized child sites
 * reference the source's assets by id via loadAssetsForBlocks' widening —
 * see render-hydration.ts's D1214 note).
 */

export const PENDING_MAX_AGE_HOURS = 24;
export const ORPHAN_MARK_DAYS = 30;
export const ORPHAN_RECLAIM_DAYS = 7;

export const MEDIA_PENDING_SWEEP = "media.pending-sweep";
export const MEDIA_ORPHAN_SWEEP = "media.orphan-sweep";

export type MediaGcDeps = {
  pool: Pool;
  bucket?: string;
  /** Injectable for tests. Default: storage.objectExists. */
  objectExists?: (gcsKey: string, bucket?: string) => Promise<boolean>;
  /** Injectable for tests. Default: storage.deleteAssetObjects. */
  deleteObjects?: (a: { gcsKey: string; siteId: string; assetId: string; bucket?: string }) => Promise<void>;
};

/** True iff the asset id appears anywhere content on its site references it. */
async function isReferenced(pool: Pool, siteId: string, assetId: string): Promise<boolean> {
  const r = await pool.query<{ referenced: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM pages
          WHERE site_id = $1
            AND (blocks::text LIKE '%' || $2 || '%'
              OR seo::text LIKE '%' || $2 || '%'
              OR COALESCE(published_snapshot::text, '') LIKE '%' || $2 || '%')
       )
       OR EXISTS (
         SELECT 1 FROM sites WHERE id = $1 AND COALESCE(seo_defaults::text, '') LIKE '%' || $2 || '%'
       )
       OR EXISTS (
         SELECT 1 FROM deleted_pages
          WHERE site_id = $1
            AND (blocks::text LIKE '%' || $2 || '%'
              OR seo::text LIKE '%' || $2 || '%'
              OR COALESCE(published_snapshot::text, '') LIKE '%' || $2 || '%')
       )
     ) AS referenced`,
    [siteId, assetId],
  );
  return r.rows[0].referenced;
}

export type PendingSweepResult = { checked: number; deleted: number };

/** D510 — reap abandoned upload rows (no GCS object) past PENDING_MAX_AGE_HOURS. */
export async function sweepAbandonedUploads(deps: MediaGcDeps): Promise<PendingSweepResult> {
  const { pool } = deps;
  const bucket = deps.bucket ?? MEDIA_BUCKET;
  const objectExists = deps.objectExists ?? gcsObjectExists;
  const deleteObjects = deps.deleteObjects ?? deleteAssetObjects;

  const candidates = await pool.query<{ id: string; site_id: string; gcs_key: string }>(
    `SELECT id, site_id, gcs_key FROM media_assets
      WHERE variants_status IN ('pending', 'failed')
        AND created_at < now() - make_interval(hours => $1::int)`,
    [PENDING_MAX_AGE_HOURS],
  );

  let deleted = 0;
  for (const row of candidates.rows) {
    // Only reap rows whose object never landed — a slow-but-real upload keeps
    // its row so /complete can still process it.
    if (await objectExists(row.gcs_key, bucket)) continue;
    // Belt-and-suspenders: clean any stray variant objects (there shouldn't
    // be any for a no-original row) before dropping the row.
    await deleteObjects({ gcsKey: row.gcs_key, siteId: row.site_id, assetId: row.id, bucket }).catch(
      () => undefined,
    );
    await pool.query(`DELETE FROM media_assets WHERE id = $1`, [row.id]);
    deleted += 1;
  }
  return { checked: candidates.rowCount ?? 0, deleted };
}

export type OrphanSweepResult = { marked: number; reclaimed: number };

/** D513 — mark long-unreferenced ready assets, reclaim archived unreferenced ones. */
export async function sweepOrphanAssets(deps: MediaGcDeps): Promise<OrphanSweepResult> {
  const { pool } = deps;
  const bucket = deps.bucket ?? MEDIA_BUCKET;
  const deleteObjects = deps.deleteObjects ?? deleteAssetObjects;

  // GC-eligible sites: ordinary sites only (never is_system covers, never a
  // template SOURCE site whose assets materialized children depend on).
  const eligibleSiteFilter = `
    site_id IN (
      SELECT id FROM sites
       WHERE NOT is_system
         AND id NOT IN (SELECT source_site_id FROM templates WHERE source_site_id IS NOT NULL)
    )`;

  // Stage 1 (MARK): ready, unarchived, older than the mark grace, unreferenced.
  const markCandidates = await pool.query<{ id: string; site_id: string }>(
    `SELECT id, site_id FROM media_assets
      WHERE archived_at IS NULL
        AND variants_status = 'ready'
        AND created_at < now() - make_interval(days => $1::int)
        AND ${eligibleSiteFilter}`,
    [ORPHAN_MARK_DAYS],
  );
  let marked = 0;
  for (const row of markCandidates.rows) {
    if (await isReferenced(pool, row.site_id, row.id)) continue;
    const r = await pool.query(
      `UPDATE media_assets SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [row.id],
    );
    marked += r.rowCount ?? 0;
  }

  // Stage 2 (RECLAIM): archived past the reclaim grace, still unreferenced →
  // hard-delete GCS objects + row.
  const reclaimCandidates = await pool.query<{ id: string; site_id: string; gcs_key: string }>(
    `SELECT id, site_id, gcs_key FROM media_assets
      WHERE archived_at IS NOT NULL
        AND archived_at < now() - make_interval(days => $1::int)
        AND ${eligibleSiteFilter}`,
    [ORPHAN_RECLAIM_DAYS],
  );
  let reclaimed = 0;
  for (const row of reclaimCandidates.rows) {
    if (await isReferenced(pool, row.site_id, row.id)) continue;
    await deleteObjects({ gcsKey: row.gcs_key, siteId: row.site_id, assetId: row.id, bucket }).catch(
      () => undefined,
    );
    await pool.query(`DELETE FROM media_assets WHERE id = $1`, [row.id]);
    reclaimed += 1;
  }

  return { marked, reclaimed };
}
