import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * P8-T8.7 — the tenant (`tenant_auth_*`) schema is multi-tenant by `site_id`
 * with PER-SITE email uniqueness. Verified with raw SQL (the Better-auth
 * adapter scoping is proven in 8.8): the same email is allowed across two
 * sites but rejected twice within one site.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("tenant_auth_* schema (P8-T8.7)", () => {
  let pool: Pool;
  let siteA: string;
  let siteB: string;

  beforeAll(async () => {
    await migrate({
      databaseUrl: TEST_DB_URL!,
      dir: MIGRATIONS_DIR,
      migrationsTable: "pgmigrations",
      direction: "up",
      count: Infinity,
      log: () => undefined,
    });
    pool = new Pool({ connectionString: TEST_DB_URL });
    const a = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t87-a','A','{}'::jsonb) RETURNING id`,
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t87-b','B','{}'::jsonb) RETURNING id`,
    );
    siteA = a.rows[0].id;
    siteB = b.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    // Cascade removes tenant_auth_* rows for these sites.
    await pool.query(`DELETE FROM sites WHERE slug IN ('p8t87-a','p8t87-b')`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates the five tenant_auth tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'tenant_auth_%' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "tenant_auth_account",
      "tenant_auth_config",
      "tenant_auth_session",
      "tenant_auth_user",
      "tenant_auth_verification",
    ]);
  });

  it("allows the same email across different sites but not twice within one site", async () => {
    const ins = (id: string, site: string) =>
      pool.query(
        `INSERT INTO tenant_auth_user (id, site_id, name, email, "emailVerified")
         VALUES ($1, $2, 'X', 'shared@example.com', false)`,
        [id, site],
      );

    await ins("p8t87-u1", siteA); // site A
    await ins("p8t87-u2", siteB); // site B — same email, different site → OK
    await expect(ins("p8t87-u3", siteA)).rejects.toThrow(); // site A again → unique violation
  });
});
