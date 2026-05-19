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
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool, sign);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool, sign, enqueue);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
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

  it("idempotent: 'ready' or 'processing' returns 202 without re-enqueue", async () => {
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
});
