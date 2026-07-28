import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { customAlphabet } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// Slug-safe suffix: lowercase alnum only, matches the `sites.slug` shape used
// throughout (see pages.ts's createPageParams slug regex for the same
// charset convention).
const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

/**
 * Shared bootstrap for AI-agent node suites. Mirrors the header of
 * tests/integration/from-template.test.ts: programmatic migrations up in
 * beforeAll, teardown in afterAll (migrations are NOT rolled back — the
 * from-template suite doesn't either, since the test DB is shared across
 * suites within the singleFork node vitest project and re-running `up` is a
 * no-op once `pgmigrations` records the migration as applied). Suites must
 * self-skip when TEST_DATABASE_URL is unset:
 * `const d = process.env.TEST_DATABASE_URL ? describe : describe.skip`.
 *
 * `teardown()` deletes every site this instance seeded (CASCADE cleans up
 * pages/page_revisions/site_domains/etc.) before ending the pool, so re-runs
 * against the shared test DB don't accumulate rows across runs.
 *
 * `seedSite` appends a short random suffix to the caller-supplied slug (e.g.
 * `agent-repo-a` -> `agent-repo-a-x7k2pq`) so two suites — or two runs of the
 * same suite — can't collide on the `sites.slug` unique constraint even
 * mid-run, before teardown has a chance to clean up. Callers that need the
 * actual persisted slug (e.g. asserting a read tool's output) should use the
 * `slug` returned from `seedSite`, not reconstruct it from the input.
 */
export function setupAgentDb() {
  let pool: Pool | null = null;
  const seededSiteIds: string[] = [];
  return {
    async runMigrations() {
      await migrate({
        databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations",
        direction: "up", count: Infinity, log: () => undefined,
      });
      pool = new Pool({ connectionString: TEST_DB_URL });
    },
    async teardown() {
      if (pool && seededSiteIds.length > 0) {
        await pool.query(`DELETE FROM sites WHERE id = ANY($1)`, [seededSiteIds]);
      }
      await pool?.end();
      pool = null;
    },
    getPool(): Pool {
      if (!pool) throw new Error("runMigrations() first");
      return pool;
    },
    async seedSite(slug: string): Promise<{ id: string; slug: string }> {
      const actualSlug = `${slug}-${suffix()}`;
      const r = await this.getPool().query<{ id: string }>(
        `INSERT INTO sites (slug, display_name) VALUES ($1, $2) RETURNING id`,
        [actualSlug, `Site ${actualSlug}`],
      );
      seededSiteIds.push(r.rows[0].id);
      return { id: r.rows[0].id, slug: actualSlug };
    },
    async seedPage(siteId: string, slug: string, blocks: unknown[] = []): Promise<{ id: string }> {
      const r = await this.getPool().query<{ id: string }>(
        `INSERT INTO pages (site_id, slug, title, blocks, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft') RETURNING id`,
        [siteId, slug, `Page ${slug}`, JSON.stringify(blocks)],
      );
      return r.rows[0];
    },
  };
}
