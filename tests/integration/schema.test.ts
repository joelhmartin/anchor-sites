import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

const d = TEST_DB_URL ? describe : describe.skip;

d("schema migrations (integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    // Reset to a clean slate: down everything, then up everything.
    await runMigrate("down", Infinity);
    await runMigrate("up", Infinity);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("creates the four core tables", async () => {
    const res = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN
       ('sites','site_domains','pages','page_revisions') ORDER BY tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      "page_revisions",
      "pages",
      "site_domains",
      "sites",
    ]);
  });

  it("pages has UNIQUE(site_id, slug) and a GIN index on blocks", async () => {
    const uniq = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='pages'
       AND indexname='pages_site_slug_unique'`,
    );
    expect(uniq.rowCount).toBe(1);

    const gin = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='pages'
       AND indexname='pages_blocks_index' AND indexdef ILIKE '%USING gin%'`,
    );
    expect(gin.rowCount).toBe(1);
  });

  it("page_revisions cascades from pages on delete", async () => {
    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('cascade-test', 'cascade test') RETURNING id`,
    );
    const siteId = siteRes.rows[0].id;
    const pageRes = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title) VALUES ($1, 'home', 'home') RETURNING id`,
      [siteId],
    );
    const pageId = pageRes.rows[0].id;
    await pool.query(
      `INSERT INTO page_revisions (page_id, blocks) VALUES ($1, '[]'::jsonb), ($1, '[]'::jsonb)`,
      [pageId],
    );

    await pool.query(`DELETE FROM pages WHERE id = $1`, [pageId]);
    const revCount = await pool.query<{ count: string }>(
      `SELECT count(*) FROM page_revisions WHERE page_id = $1`,
      [pageId],
    );
    expect(Number(revCount.rows[0].count)).toBe(0);

    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
  });

  it("updated_at trigger touches the timestamp on UPDATE", async () => {
    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('updated-at-test', 'updated_at test') RETURNING id`,
    );
    const siteId = siteRes.rows[0].id;
    const before = await pool.query<{ id: string; updated_at: Date }>(
      `INSERT INTO pages (site_id, slug, title) VALUES ($1, 'home', 'home')
       RETURNING id, updated_at`,
      [siteId],
    );
    const pageId = before.rows[0].id;
    const t0 = before.rows[0].updated_at;

    await new Promise((r) => setTimeout(r, 25));
    const after = await pool.query<{ updated_at: Date }>(
      `UPDATE pages SET title = 'changed' WHERE id = $1 RETURNING updated_at`,
      [pageId],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(t0.getTime());

    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
  });

  it("CHECK constraints reject invalid status values", async () => {
    await pool.query(
      `INSERT INTO sites (slug, display_name) VALUES ('check-test', 'check')`,
    );
    const bad = pool.query(
      `UPDATE sites SET status = 'wat' WHERE slug = 'check-test'`,
    );
    await expect(bad).rejects.toThrow(/check/i);
    await pool.query(`DELETE FROM sites WHERE slug = 'check-test'`);
  });

  it("pages.brand_tokens_override is a nullable jsonb (P3-T3.4)", async () => {
    const res = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'brand_tokens_override'`,
    );
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].data_type).toBe("jsonb");
    expect(res.rows[0].is_nullable).toBe("YES");

    // Functional: a NULL row inserts fine, and a JSONB override is queryable.
    const site = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('bto-test', 'BTO Test') RETURNING id`,
    );
    const siteId = site.rows[0].id;
    try {
      const ins = await pool.query<{ id: string; bto: unknown }>(
        `INSERT INTO pages (site_id, slug, title, blocks, seo, brand_tokens_override)
         VALUES ($1, 'home', 'Home', '[]'::jsonb, '{}'::jsonb, $2::jsonb)
         RETURNING id, brand_tokens_override AS bto`,
        [siteId, JSON.stringify({ "--theme-main": "#ff0000" })],
      );
      expect(ins.rows[0].bto).toEqual({ "--theme-main": "#ff0000" });

      const nullIns = await pool.query(
        `INSERT INTO pages (site_id, slug, title, blocks, seo) VALUES ($1, 'other', 'Other', '[]'::jsonb, '{}'::jsonb)
         RETURNING brand_tokens_override`,
        [siteId],
      );
      expect(nullIns.rows[0].brand_tokens_override).toBeNull();
    } finally {
      await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
    }
  });

  it("media_assets table has expected shape + FK cascade + check constraint (P3-T3.6)", async () => {
    const cols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_assets'
        ORDER BY ordinal_position`,
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id", "site_id", "gcs_key", "content_type", "alt", "focal_point",
        "variants_status", "variants", "original_bytes", "width", "height",
        "created_at", "processed_at", "archived_at", "last_error",
      ]),
    );

    // FK cascade: dropping the site removes its media rows.
    const site = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('ma-cascade', 'MA Cascade') RETURNING id`,
    );
    const siteId = site.rows[0].id;
    await pool.query(
      `INSERT INTO media_assets (site_id, gcs_key, content_type)
       VALUES ($1, $2, 'image/png')`,
      [siteId, `${siteId}/originals/a.png`],
    );
    const beforeDrop = await pool.query(`SELECT count(*) FROM media_assets WHERE site_id = $1`, [siteId]);
    expect(Number(beforeDrop.rows[0].count)).toBe(1);

    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]);
    const afterDrop = await pool.query(`SELECT count(*) FROM media_assets WHERE site_id = $1`, [siteId]);
    expect(Number(afterDrop.rows[0].count)).toBe(0);

    // CHECK constraint on variants_status — need a site row to attach to.
    const check = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('ma-check', 'MA Check') RETURNING id`,
    );
    const checkSiteId = check.rows[0].id;
    try {
      const bad = pool.query(
        `INSERT INTO media_assets (site_id, gcs_key, content_type, variants_status)
         VALUES ($1, 'tmp/bad', 'image/png', 'bogus')`,
        [checkSiteId],
      );
      await expect(bad).rejects.toThrow(/check/i);
    } finally {
      await pool.query(`DELETE FROM sites WHERE id = $1`, [checkSiteId]);
    }
  });

  it("migrate down then up returns to clean schema", async () => {
    await runMigrate("down", Infinity);
    const empty = await pool.query(
      `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
       ('sites','site_domains','pages','page_revisions','media_assets')`,
    );
    expect(Number(empty.rows[0].count)).toBe(0);

    await runMigrate("up", Infinity);
    const back = await pool.query(
      `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
       ('sites','site_domains','pages','page_revisions','media_assets')`,
    );
    expect(Number(back.rows[0].count)).toBe(5);
  }, 60_000);
});
