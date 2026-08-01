import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import {
  sweepAbandonedUploads,
  sweepOrphanAssets,
  PENDING_MAX_AGE_HOURS,
  ORPHAN_MARK_DAYS,
  ORPHAN_RECLAIM_DAYS,
} from "./media-gc.js";
import { randomUUID } from "node:crypto";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

/** Records which asset object-families were asked to be deleted. */
function fakeDeletes() {
  const deleted: string[] = [];
  return {
    deleted,
    deleteObjects: async (a: { assetId: string }) => {
      deleted.push(a.assetId);
    },
  };
}

async function insertAsset(
  pool: ReturnType<typeof db.getPool>,
  args: {
    siteId: string;
    status?: string;
    createdDaysAgo?: number;
    createdHoursAgo?: number;
    archivedDaysAgo?: number | null;
  },
): Promise<string> {
  const id = randomUUID();
  const gcsKey = `originals/${args.siteId}/${id}.jpg`;
  await pool.query(
    `INSERT INTO media_assets (id, site_id, gcs_key, content_type, alt, variants_status,
                               created_at, archived_at)
     VALUES ($1, $2, $3, 'image/jpeg', 'x', $4,
             now() - make_interval(hours => $5::int, days => $6::int),
             CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(days => $7::int) END)`,
    [
      id,
      args.siteId,
      gcsKey,
      args.status ?? "ready",
      args.createdHoursAgo ?? 0,
      args.createdDaysAgo ?? 0,
      args.archivedDaysAgo ?? null,
    ],
  );
  return id;
}

d("media GC sweeps (D510 / D513)", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("media-gc")).id;
  });
  afterAll(() => db.teardown());

  it("D510: deletes a stale pending row with no GCS object, keeps a fresh one and a real-object one", async () => {
    const pool = db.getPool();
    const stale = await insertAsset(pool, { siteId, status: "pending", createdHoursAgo: PENDING_MAX_AGE_HOURS + 1 });
    const fresh = await insertAsset(pool, { siteId, status: "pending", createdHoursAgo: 1 });
    const staleButLanded = await insertAsset(pool, { siteId, status: "pending", createdHoursAgo: PENDING_MAX_AGE_HOURS + 1 });
    const staleFailed = await insertAsset(pool, { siteId, status: "failed", createdHoursAgo: PENDING_MAX_AGE_HOURS + 1 });

    const { deleteObjects } = fakeDeletes();
    const res = await sweepAbandonedUploads({
      pool,
      // Only `staleButLanded` has a real object.
      objectExists: async (key: string) => key.includes(staleButLanded),
      deleteObjects,
    });

    expect(res.deleted).toBe(2); // stale + staleFailed
    const survivors = await pool.query<{ id: string }>(
      `SELECT id FROM media_assets WHERE id = ANY($1)`,
      [[stale, fresh, staleButLanded, staleFailed]],
    );
    const ids = survivors.rows.map((r) => r.id);
    expect(ids).toContain(fresh);
    expect(ids).toContain(staleButLanded);
    expect(ids).not.toContain(stale);
    expect(ids).not.toContain(staleFailed);
  });

  it("D513 MARK: archives an old, unreferenced ready asset; leaves a referenced one alone", async () => {
    const pool = db.getPool();
    const orphan = await insertAsset(pool, { siteId, status: "ready", createdDaysAgo: ORPHAN_MARK_DAYS + 1 });
    const referenced = await insertAsset(pool, { siteId, status: "ready", createdDaysAgo: ORPHAN_MARK_DAYS + 1 });
    // Reference `referenced` from a page block (asset_id anywhere in blocks).
    await pool.query(
      `INSERT INTO pages (site_id, slug, title, blocks, status)
       VALUES ($1, 'ref-page', 'Ref', $2::jsonb, 'draft')`,
      [siteId, JSON.stringify([{ id: "b1", type: "image", props: { asset_id: referenced } }])],
    );

    const { deleteObjects, deleted } = fakeDeletes();
    const res = await sweepOrphanAssets({ pool, deleteObjects });
    expect(res.marked).toBeGreaterThanOrEqual(1);
    expect(deleted).toHaveLength(0); // nothing reclaimed yet (fresh archives)

    const rows = await pool.query<{ id: string; archived_at: string | null }>(
      `SELECT id, archived_at FROM media_assets WHERE id = ANY($1)`,
      [[orphan, referenced]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.archived_at]));
    expect(byId.get(orphan)).not.toBeNull();
    expect(byId.get(referenced)).toBeNull();
  });

  it("D513 RECLAIM: hard-deletes an archived, unreferenced asset past the reclaim grace", async () => {
    const pool = db.getPool();
    const reclaimable = await insertAsset(pool, {
      siteId,
      status: "ready",
      createdDaysAgo: 60,
      archivedDaysAgo: ORPHAN_RECLAIM_DAYS + 1,
    });
    const recentlyArchived = await insertAsset(pool, {
      siteId,
      status: "ready",
      createdDaysAgo: 60,
      archivedDaysAgo: 1,
    });

    const { deleteObjects, deleted } = fakeDeletes();
    const res = await sweepOrphanAssets({ pool, deleteObjects });
    expect(res.reclaimed).toBeGreaterThanOrEqual(1);
    expect(deleted).toContain(reclaimable);
    expect(deleted).not.toContain(recentlyArchived);

    const gone = await pool.query(`SELECT 1 FROM media_assets WHERE id = $1`, [reclaimable]);
    expect(gone.rowCount).toBe(0);
    const survives = await pool.query(`SELECT 1 FROM media_assets WHERE id = $1`, [recentlyArchived]);
    expect(survives.rowCount).toBe(1);
  });

  it("D513: never touches a system-site asset", async () => {
    const pool = db.getPool();
    const sys = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, status, is_system)
       VALUES ($1, 'sys', 'archived', true) RETURNING id`,
      [`media-gc-sys-${Date.now()}`],
    );
    const sysAsset = await insertAsset(pool, {
      siteId: sys.rows[0].id,
      status: "ready",
      createdDaysAgo: 100,
      archivedDaysAgo: 100,
    });
    const { deleteObjects, deleted } = fakeDeletes();
    await sweepOrphanAssets({ pool, deleteObjects });
    expect(deleted).not.toContain(sysAsset);
    const survives = await pool.query(`SELECT 1 FROM media_assets WHERE id = $1`, [sysAsset]);
    expect(survives.rowCount).toBe(1);
    await pool.query(`DELETE FROM sites WHERE id = $1`, [sys.rows[0].id]);
  });
});
