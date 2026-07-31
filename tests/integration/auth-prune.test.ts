import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneExpiredAuthRows } from "../../src/server/jobs/auth-prune.js";

/**
 * D805 — the expired-session sweep, driven against the REAL migrated schema
 * so the quoted `"expiresAt"` identifiers are verified (the Better-auth
 * tables are camelCase case-preserved; an unquoted DELETE would throw
 * "column expiresat does not exist" at runtime, not in a unit test).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("pruneExpiredAuthRows (D805)", () => {
  let pool: Pool;
  let siteId: string;

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

    // Studio side: one user, one expired + one live session, one expired +
    // one live verification row.
    await pool.query(
      `INSERT INTO auth_user (id, name, email) VALUES ('d805-u1', 'Prune Test', 'd805-prune@test.local')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO auth_session (id, "expiresAt", token, "userId") VALUES
        ('d805-s-expired', now() - interval '1 hour', 'd805-tok-expired', 'd805-u1'),
        ('d805-s-live',    now() + interval '1 hour', 'd805-tok-live',    'd805-u1')`,
    );
    await pool.query(
      `INSERT INTO auth_verification (id, identifier, value, "expiresAt") VALUES
        ('d805-v-expired', 'd805-oauth-state', '{}', now() - interval '1 hour'),
        ('d805-v-live',    'd805-oauth-state', '{}', now() + interval '1 hour')`,
    );

    // Tenant side (same shape + site_id FK): one expired session.
    const site = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('d805-prune-site', 'D805 Prune') RETURNING id`,
    );
    siteId = site.rows[0].id;
    await pool.query(
      `INSERT INTO tenant_auth_user (id, site_id, name, email) VALUES ('d805-tu1', $1, 'T', 't@t.local')`,
      [siteId],
    );
    await pool.query(
      `INSERT INTO tenant_auth_session (id, site_id, "expiresAt", token, "userId") VALUES
        ('d805-ts-expired', $1, now() - interval '1 hour', 'd805-ttok-expired', 'd805-tu1'),
        ('d805-ts-live',    $1, now() + interval '1 hour', 'd805-ttok-live',    'd805-tu1')`,
      [siteId],
    );
    await pool.query(
      `INSERT INTO tenant_auth_verification (id, site_id, identifier, value, "expiresAt") VALUES
        ('d805-tv-expired', $1, 'x', '{}', now() - interval '1 hour')`,
      [siteId],
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM auth_user WHERE id = 'd805-u1'`).catch(() => undefined);
    await pool.query(`DELETE FROM auth_verification WHERE id LIKE 'd805-%'`).catch(() => undefined);
    // sites CASCADE cleans tenant_auth_* rows.
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("deletes only expired rows, across studio AND tenant tables, and reports counts", async () => {
    const counts = await pruneExpiredAuthRows(pool);
    expect(counts.auth_session).toBeGreaterThanOrEqual(1);
    expect(counts.auth_verification).toBeGreaterThanOrEqual(1);
    expect(counts.tenant_auth_session).toBeGreaterThanOrEqual(1);
    expect(counts.tenant_auth_verification).toBeGreaterThanOrEqual(1);

    // Live rows survive.
    const live = await pool.query(`SELECT id FROM auth_session WHERE id LIKE 'd805-%' ORDER BY 1`);
    expect(live.rows.map((r) => r.id)).toEqual(["d805-s-live"]);
    const liveV = await pool.query(`SELECT id FROM auth_verification WHERE id LIKE 'd805-%'`);
    expect(liveV.rows.map((r) => r.id)).toEqual(["d805-v-live"]);
    const liveT = await pool.query(`SELECT id FROM tenant_auth_session WHERE id LIKE 'd805-%'`);
    expect(liveT.rows.map((r) => r.id)).toEqual(["d805-ts-live"]);

    // Idempotent: a second run deletes nothing.
    const again = await pruneExpiredAuthRows(pool);
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });
});
