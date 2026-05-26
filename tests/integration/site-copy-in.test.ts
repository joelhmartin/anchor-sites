import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSiteWithDomains } from "../../src/server/sites/create-site.js";
import { seedSiteCopyIn } from "../../src/server/sites/copy-in.js";

/**
 * P8-T8.12 — provisioning a site seeds the per-site copy-in (D-047):
 * tenant_auth_config + a draft welcome post, idempotently.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("site copy-in at provision (P8-T8.12)", () => {
  let pool: Pool;
  let siteId: string;

  beforeAll(async () => {
    await migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction: "up", count: Infinity, log: () => undefined });
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query(`DELETE FROM sites WHERE slug = 'p8t812'`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await createSiteWithDomains(client, { slug: "p8t812", displayName: "Copy-in Test" });
      siteId = r.siteId;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'p8t812'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("seeds a tenant_auth_config row with default providers", async () => {
    const r = await pool.query<{ providers: { emailPassword?: boolean } }>(
      `SELECT providers FROM tenant_auth_config WHERE site_id = $1`,
      [siteId],
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].providers.emailPassword).toBe(true);
  });

  it("seeds a DRAFT welcome post (not public)", async () => {
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM posts WHERE site_id = $1 AND slug = 'welcome'`,
      [siteId],
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].status).toBe("draft");
  });

  it("is idempotent (re-running adds no duplicates)", async () => {
    const client = await pool.connect();
    try {
      await seedSiteCopyIn(client, siteId);
      await seedSiteCopyIn(client, siteId);
    } finally {
      client.release();
    }
    const cfg = await pool.query(`SELECT 1 FROM tenant_auth_config WHERE site_id = $1`, [siteId]);
    const posts = await pool.query(`SELECT 1 FROM posts WHERE site_id = $1 AND slug = 'welcome'`, [siteId]);
    expect(cfg.rowCount).toBe(1);
    expect(posts.rowCount).toBe(1);
  });
});
