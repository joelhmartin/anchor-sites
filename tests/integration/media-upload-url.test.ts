import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../db/seed.js";
import { mediaRouter } from "../../src/server/routes/media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-media";

// vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
// then guarantees this resets before the next test anywhere in the suite,
// regardless of how long any describe's own `afterAll` takes (root cause of
// the cross-file requireAdmin flake — see
// .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
beforeEach(() => {
  vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
});

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

function buildApp(
  pool: Pool,
  signUpload: typeof import("../../src/server/media/storage.js").signUploadUrl,
  enqueue?: (jobName: string, data: unknown) => Promise<string | null>,
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    mediaRouter({
      pool,
      signUpload,
      uploadRateLimit: { max: 100, windowMs: 60_000 },
      enqueue,
    }),
  );
  return app;
}

d("POST /api/sites/:siteId/media/upload-url (P3-T3.9)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonSiteId: string;
  const sign = vi.fn(async (args: { gcsKey: string; contentType: string }) => ({
    upload_url: `https://storage.googleapis.com/anchorcorps-media/${args.gcsKey}?X-Goog-Signature=fake`,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    headers: { "Content-Type": args.contentType },
  }));

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'muldoon-dental'`,
    );
    muldoonSiteId = r.rows[0].id;
    app = buildApp(pool, sign);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    sign.mockClear();
  });

  it("401 without admin token", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/upload-url`)
      .send({ content_type: "image/jpeg" });
    expect(r.status).toBe(401);
  });

  it("400 on unsupported content_type", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/upload-url`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ content_type: "application/zip" });
    expect(r.status).toBe(400);
  });

  it("404 when site does not exist", async () => {
    const r = await request(app)
      .post(`/api/sites/00000000-0000-0000-0000-000000000000/media/upload-url`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ content_type: "image/jpeg" });
    expect(r.status).toBe(404);
  });

  it("returns asset_id + signed upload_url + persists media_assets row", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/upload-url`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ content_type: "image/png", alt: "Logo", focal_point: { x: 0.5, y: 0.4 } });
    expect(r.status).toBe(200);
    expect(r.body.asset_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.gcs_key).toBe(`originals/${muldoonSiteId}/${r.body.asset_id}.png`);
    expect(r.body.upload_url).toContain("X-Goog-Signature=fake");
    expect(r.body.headers["Content-Type"]).toBe("image/png");

    // signUpload called with the right key + content type.
    expect(sign).toHaveBeenCalledWith({
      gcsKey: `originals/${muldoonSiteId}/${r.body.asset_id}.png`,
      contentType: "image/png",
    });

    // Row persisted with pending status + the metadata.
    const row = await pool.query(
      `SELECT site_id, gcs_key, content_type, alt, focal_point, variants_status
         FROM media_assets WHERE id = $1`,
      [r.body.asset_id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].site_id).toBe(muldoonSiteId);
    expect(row.rows[0].gcs_key).toBe(`originals/${muldoonSiteId}/${r.body.asset_id}.png`);
    expect(row.rows[0].content_type).toBe("image/png");
    expect(row.rows[0].alt).toBe("Logo");
    expect(row.rows[0].focal_point).toEqual({ x: 0.5, y: 0.4 });
    expect(row.rows[0].variants_status).toBe("pending");
  });

  // ── W2-CONC / D509: single-statement insert, no shared 'pending' key ──

  it("D509: concurrent upload-url calls all succeed (no shared-placeholder unique_violation), and a stranded legacy 'pending' row no longer blocks anything", async () => {
    // Simulate what the OLD two-step flow left behind after a crash between
    // its INSERT and UPDATE: a row whose gcs_key is the literal 'pending'.
    // Under the old code, the next INSERT of 'pending' collided with it —
    // every future upload on the whole platform 500'd.
    await pool.query(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt)
       VALUES ($1, 'pending', 'image/jpeg', '')`,
      [muldoonSiteId],
    );

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post(`/api/sites/${muldoonSiteId}/media/upload-url`)
          .set("X-Admin-Token", ADMIN_TOKEN)
          .send({ content_type: "image/jpeg", alt: "concurrent" }),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      // The row is born with its final id-derived key — never 'pending'.
      expect(r.body.gcs_key).toBe(`originals/${muldoonSiteId}/${r.body.asset_id}.jpg`);
      const row = await pool.query<{ gcs_key: string }>(
        `SELECT gcs_key FROM media_assets WHERE id = $1`,
        [r.body.asset_id],
      );
      expect(row.rows[0].gcs_key).toBe(`originals/${muldoonSiteId}/${r.body.asset_id}.jpg`);
    }

    // Cleanup the simulated legacy strand so other tests never trip on it.
    await pool.query(`DELETE FROM media_assets WHERE gcs_key = 'pending'`);
  });

  it("rejects out-of-range focal_point coords", async () => {
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/upload-url`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ content_type: "image/png", focal_point: { x: 1.5, y: 0.5 } });
    expect(r.status).toBe(400);
  });
});

d("POST /api/sites/:siteId/media/:assetId/complete (P3-T3.11)", () => {
  let pool: Pool;
  let muldoonSiteId: string;
  const enqueue = vi.fn(async () => "fake-job-id");
  const sign = vi.fn(async (args: { gcsKey: string; contentType: string }) => ({
    upload_url: "x",
    expires_at: new Date().toISOString(),
    headers: { "Content-Type": args.contentType },
  }));
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'muldoon-dental'`,
    );
    muldoonSiteId = r.rows[0].id;
    app = buildApp(pool, sign, enqueue);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(async () => {
    enqueue.mockClear();
    await pool.query(`DELETE FROM media_assets WHERE site_id = $1`, [muldoonSiteId]);
  });

  let assetCounter = 0;
  async function makeAsset(status: string = "pending"): Promise<string> {
    assetCounter += 1;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, variants_status)
       VALUES ($1, $2, 'image/png', $3) RETURNING id`,
      [muldoonSiteId, `originals/${muldoonSiteId}/x-${assetCounter}-${Date.now()}.png`, status],
    );
    return ins.rows[0].id;
  }

  it("401 without admin token", async () => {
    const assetId = await makeAsset();
    const r = await request(app).post(
      `/api/sites/${muldoonSiteId}/media/${assetId}/complete`,
    );
    expect(r.status).toBe(401);
  });

  it("404 when asset belongs to a different site", async () => {
    const assetId = await makeAsset();
    const r = await request(app)
      .post(`/api/sites/00000000-0000-0000-0000-000000000000/media/${assetId}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("enqueues media.process-upload on first call (pending → pending, enqueued=true)", async () => {
    const assetId = await makeAsset("pending");
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/${assetId}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ asset_id: assetId, enqueued: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = enqueue.mock.calls[0] as unknown as [string, { asset_id: string }];
    expect(call[0]).toBe("media.process-upload");
    expect(call[1]).toEqual({ asset_id: assetId });
  });

  it("idempotent: 'ready' or FRESH 'processing' returns 202 without re-enqueue", async () => {
    const r1 = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/${await makeAsset("ready")}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r1.status).toBe(202);
    expect(r1.body.enqueued).toBe(false);

    const r2 = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/${await makeAsset("processing")}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r2.status).toBe(202);
    expect(r2.body.enqueued).toBe(false);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("D604: a STALE 'processing' row (never processed, >15min old) is retryable — re-enqueues", async () => {
    const assetId = await makeAsset("processing");
    // Age the row past the 15-min stale window with processed_at still null
    // (the worker-died-mid-processing signature).
    await pool.query(
      `UPDATE media_assets SET created_at = now() - interval '20 minutes', processed_at = NULL WHERE id = $1`,
      [assetId],
    );
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/${assetId}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ enqueued: true, retried_stale: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("D604: a 'ready' row aged past 15min is still terminal — never re-enqueues", async () => {
    const assetId = await makeAsset("ready");
    await pool.query(
      `UPDATE media_assets SET created_at = now() - interval '20 minutes', processed_at = now() WHERE id = $1`,
      [assetId],
    );
    const r = await request(app)
      .post(`/api/sites/${muldoonSiteId}/media/${assetId}/complete`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(202);
    expect(r.body.enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// D417 — PATCH /api/sites/:siteId/media/:assetId — edit alt text
// ---------------------------------------------------------------------------
d("PATCH /api/sites/:siteId/media/:assetId (D417 — alt edit)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;
  let otherSiteId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const rows = await pool.query<{ id: string }>(`SELECT id FROM sites LIMIT 2`);
    siteId = rows.rows[0].id;
    otherSiteId = rows.rows[1]?.id ?? siteId;
    app = express();
    app.use(express.json());
    app.use("/api", mediaRouter({ pool }));
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  async function makeAsset(site: string): Promise<string> {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO media_assets (id, site_id, gcs_key, content_type, alt)
       VALUES ($1, $2, $3, 'image/png', 'IMG_4032.jpg')`,
      [id, site, `originals/${site}/${id}.png`],
    );
    return id;
  }

  it("updates the alt and returns it", async () => {
    const id = await makeAsset(siteId);
    const r = await request(app)
      .patch(`/api/sites/${siteId}/media/${id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ alt: "A dentist examining a patient" });
    expect(r.status).toBe(200);
    expect(r.body.asset.alt).toBe("A dentist examining a patient");
    const row = await pool.query(`SELECT alt FROM media_assets WHERE id = $1`, [id]);
    expect(row.rows[0].alt).toBe("A dentist examining a patient");
  });

  it("404 when the asset belongs to another site (tenant-scoped)", async () => {
    const id = await makeAsset(otherSiteId);
    const r = await request(app)
      .patch(`/api/sites/${siteId}/media/${id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ alt: "nope" });
    // Only 404 when otherSiteId truly differs; if the seed had one site, skip.
    if (otherSiteId !== siteId) expect(r.status).toBe(404);
  });

  it("400 on invalid payload", async () => {
    const id = await makeAsset(siteId);
    const r = await request(app)
      .patch(`/api/sites/${siteId}/media/${id}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ alt: 123 });
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/sites/:siteId/media/:assetId (D106/D408/D511) — soft archive.
// ---------------------------------------------------------------------------
d("DELETE /api/sites/:siteId/media/:assetId (D106/D408/D511)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;
  const sign = vi.fn(async (args: { gcsKey: string; contentType: string }) => ({
    upload_url: "https://example/x",
    expires_at: new Date().toISOString(),
    headers: { "Content-Type": args.contentType },
  }));

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug = 'muldoon-dental'`);
    siteId = r.rows[0].id;
    app = buildApp(pool, sign);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  async function makeAsset() {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt)
       VALUES ($1, $2, 'image/jpeg', 'x') RETURNING id`,
      [siteId, `originals/${siteId}/${crypto.randomUUID()}.jpg`],
    );
    return r.rows[0].id;
  }

  it("401 without token", async () => {
    const r = await request(app).delete(`/api/sites/${siteId}/media/${crypto.randomUUID()}`);
    expect(r.status).toBe(401);
  });

  it("404 for an unknown asset", async () => {
    const r = await request(app)
      .delete(`/api/sites/${siteId}/media/${crypto.randomUUID()}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("archives an asset (sets archived_at) and drops it from the listing", async () => {
    const assetId = await makeAsset();
    const del = await request(app)
      .delete(`/api/sites/${siteId}/media/${assetId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(del.status).toBe(200);
    expect(del.body.archived.id).toBe(assetId);

    const row = await pool.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM media_assets WHERE id = $1`,
      [assetId],
    );
    expect(row.rows[0].archived_at).not.toBeNull();

    // Second delete is a 404 — it's already gone from the library.
    const again = await request(app)
      .delete(`/api/sites/${siteId}/media/${assetId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(again.status).toBe(404);
  });
});
