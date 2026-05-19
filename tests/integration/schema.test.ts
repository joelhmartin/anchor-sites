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

  it("migrate down then up returns to clean schema", async () => {
    await runMigrate("down", Infinity);
    const empty = await pool.query(
      `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
       ('sites','site_domains','pages','page_revisions')`,
    );
    expect(Number(empty.rows[0].count)).toBe(0);

    await runMigrate("up", Infinity);
    const back = await pool.query(
      `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
       ('sites','site_domains','pages','page_revisions')`,
    );
    expect(Number(back.rows[0].count)).toBe(4);
  }, 60_000);
});
