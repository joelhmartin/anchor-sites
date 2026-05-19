import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import sharp from "sharp";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../db/seed.js";
import { handleMediaProcessUpload } from "../../src/server/jobs/media-process-upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

/**
 * Build an in-memory image buffer at a given size. sharp can generate
 * test fixtures on the fly — no on-disk file needed.
 */
async function fixturePng(width = 1600, height = 900): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 30, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Minimal fake of the @google-cloud/storage Storage client surface the
 * variant job uses: `.bucket(name).file(key).download()` + `.save()`.
 * Backed by an in-memory Map so the test can preload the original and
 * inspect uploaded variants.
 */
function makeFakeStorage() {
  const blobs = new Map<string, Buffer>(); // bucket:key → bytes
  const meta = new Map<string, { contentType?: string; cacheControl?: string }>();

  function fileApi(bucketName: string, key: string) {
    const k = `${bucketName}:${key}`;
    return {
      download: async (): Promise<[Buffer]> => {
        const b = blobs.get(k);
        if (!b) throw new Error(`fake-gcs: missing ${k}`);
        return [b];
      },
      save: async (
        body: Buffer,
        opts: { metadata?: { contentType?: string; cacheControl?: string } },
      ) => {
        blobs.set(k, body);
        if (opts.metadata) meta.set(k, opts.metadata);
      },
    };
  }
  return {
    storage: {
      bucket: (name: string) => ({
        file: (key: string) => fileApi(name, key),
      }),
    } as unknown as ReturnType<typeof import("../../src/server/media/storage.js").getStorage>,
    blobs,
    meta,
    seedOriginal: (bucket: string, key: string, body: Buffer) => {
      blobs.set(`${bucket}:${key}`, body);
    },
  };
}

d("handleMediaProcessUpload (P3-T3.10)", () => {
  let pool: Pool;
  let muldoonSiteId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'muldoon-dental'`,
    );
    muldoonSiteId = r.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM media_assets WHERE site_id = $1`, [muldoonSiteId]);
  });

  it("transitions pending → ready, writes 10 variants (5 sizes × 2 formats), updates the row", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type)
       VALUES ($1, $2, 'image/png') RETURNING id`,
      [muldoonSiteId, `originals/${muldoonSiteId}/seed.png`],
    );
    const assetId = ins.rows[0].id;
    const gcsKey = `originals/${muldoonSiteId}/${assetId}.png`;
    await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

    const fake = makeFakeStorage();
    fake.seedOriginal("anchorcorps-media", gcsKey, await fixturePng(1600, 900));

    const result = await handleMediaProcessUpload(
      { asset_id: assetId },
      { pool, bucket: "anchorcorps-media", storage: fake.storage },
    );

    // 5 sizes × 2 formats = 10 variants
    expect(result.variants).toHaveLength(10);
    // sm / 480w in webp should be the smallest WebP rendition.
    const sm_webp = result.variants.find((v) => v.name === "sm" && v.format === "webp");
    expect(sm_webp).toBeDefined();
    expect(sm_webp!.width).toBeLessThanOrEqual(480);
    expect(sm_webp!.url).toMatch(/^https:\/\/storage\.googleapis\.com\/anchorcorps-media\/variants\//);
    expect(sm_webp!.url).toMatch(/-sm\.[0-9a-f]{10}\.webp$/);

    // Variants in the bucket carry the immutable cache header.
    const someKey = Array.from(fake.blobs.keys()).find((k) => k.includes("variants/"));
    expect(someKey).toBeDefined();
    expect(fake.meta.get(someKey!)?.cacheControl).toBe("public, max-age=31536000, immutable");

    // DB row reflects the transition.
    const row = await pool.query<{
      variants_status: string;
      variants: typeof result.variants;
      width: number;
      height: number;
      processed_at: Date;
    }>(`SELECT variants_status, variants, width, height, processed_at FROM media_assets WHERE id = $1`, [assetId]);
    expect(row.rows[0].variants_status).toBe("ready");
    expect(row.rows[0].variants).toHaveLength(10);
    expect(row.rows[0].width).toBe(1600);
    expect(row.rows[0].height).toBe(900);
    expect(row.rows[0].processed_at).toBeInstanceOf(Date);
  }, 30_000);

  it("does not upscale: sm width caps at source width when smaller than 480", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type)
       VALUES ($1, $2, 'image/png') RETURNING id`,
      [muldoonSiteId, `originals/${muldoonSiteId}/small.png`],
    );
    const assetId = ins.rows[0].id;
    const gcsKey = `originals/${muldoonSiteId}/${assetId}.png`;
    await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

    const fake = makeFakeStorage();
    fake.seedOriginal("anchorcorps-media", gcsKey, await fixturePng(300, 300));

    const result = await handleMediaProcessUpload(
      { asset_id: assetId },
      { pool, bucket: "anchorcorps-media", storage: fake.storage },
    );
    // sm target is 480 but source is 300 — variant width caps at 300.
    const sm = result.variants.find((v) => v.name === "sm" && v.format === "webp");
    expect(sm!.width).toBe(300);
    // 2x also caps at source width.
    const x2 = result.variants.find((v) => v.name === "2x" && v.format === "jpg");
    expect(x2!.width).toBe(300);
  }, 30_000);

  it("on failure (download throws), sets variants_status='failed' + last_error, rethrows", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type)
       VALUES ($1, $2, 'image/png') RETURNING id`,
      [muldoonSiteId, `originals/${muldoonSiteId}/missing.png`],
    );
    const assetId = ins.rows[0].id;
    const gcsKey = `originals/${muldoonSiteId}/${assetId}.png`;
    await pool.query(`UPDATE media_assets SET gcs_key = $1 WHERE id = $2`, [gcsKey, assetId]);

    // Fake storage WITHOUT seeding the original → download throws.
    const fake = makeFakeStorage();

    await expect(
      handleMediaProcessUpload(
        { asset_id: assetId },
        { pool, bucket: "anchorcorps-media", storage: fake.storage },
      ),
    ).rejects.toThrow(/missing/);

    const row = await pool.query<{ variants_status: string; last_error: string | null }>(
      `SELECT variants_status, last_error FROM media_assets WHERE id = $1`,
      [assetId],
    );
    expect(row.rows[0].variants_status).toBe("failed");
    expect(row.rows[0].last_error).toMatch(/missing/);
  });

  it("idempotency: when row is already 'ready', no-op return", async () => {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, variants_status, variants)
       VALUES ($1, $2, 'image/png', 'ready', $3::jsonb) RETURNING id`,
      [
        muldoonSiteId,
        `originals/${muldoonSiteId}/done.png`,
        JSON.stringify([{ name: "sm", format: "webp", width: 480, height: 270, url: "x", bytes: 1 }]),
      ],
    );
    const assetId = ins.rows[0].id;

    const fake = makeFakeStorage(); // no seed needed — handler shouldn't read anything
    const result = await handleMediaProcessUpload(
      { asset_id: assetId },
      { pool, bucket: "anchorcorps-media", storage: fake.storage },
    );
    expect(result.variants).toHaveLength(1);
    expect(fake.blobs.size).toBe(0); // no writes happened
  });
});
