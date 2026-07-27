import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/**
 * Shared bootstrap for AI-agent node suites. Mirrors the header of
 * tests/integration/from-template.test.ts: programmatic migrations up in
 * beforeAll, pool.end() in afterAll (migrations are NOT rolled back — the
 * from-template suite doesn't either, since the test DB is shared across
 * suites within the singleFork node vitest project and re-running `up` is a
 * no-op once `pgmigrations` records the migration as applied). Suites must
 * self-skip when TEST_DATABASE_URL is unset:
 * `const d = process.env.TEST_DATABASE_URL ? describe : describe.skip`.
 *
 * seedSite/seedPage take caller-supplied slugs — use a unique prefix per
 * suite (e.g. "agent-repo-a") so concurrent suites sharing the test DB don't
 * collide on the `sites.slug` unique constraint.
 */
export function setupAgentDb() {
  let pool: Pool | null = null;
  return {
    async runMigrations() {
      await migrate({
        databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations",
        direction: "up", count: Infinity, log: () => undefined,
      });
      pool = new Pool({ connectionString: TEST_DB_URL });
    },
    async teardown() {
      await pool?.end();
      pool = null;
    },
    getPool(): Pool {
      if (!pool) throw new Error("runMigrations() first");
      return pool;
    },
    async seedSite(slug: string): Promise<{ id: string }> {
      const r = await this.getPool().query<{ id: string }>(
        `INSERT INTO sites (slug, display_name) VALUES ($1, $2) RETURNING id`,
        [slug, `Site ${slug}`],
      );
      return r.rows[0];
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
