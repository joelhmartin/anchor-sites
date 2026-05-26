import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudioAuth } from "../../src/server/auth/studio-auth.js";

/**
 * P8-T8.2 — the Studio `auth_*` migration must match exactly what Better-auth's
 * adapter queries. Because Better-auth (Kysely) quotes its camelCase
 * identifiers, a snake_case or unquoted DDL would silently break at runtime, so
 * we verify by driving the REAL Better-auth adapter against the migrated
 * tables: create a user, read it back, delete it. If the columns didn't line
 * up, the adapter's quoted `"emailVerified"` / `"createdAt"` queries would
 * throw "column does not exist".
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const GOOGLE_ENV = {
  ...process.env,
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  BETTER_AUTH_SECRET: "test-session-secret-0123456789abcdef",
} satisfies NodeJS.ProcessEnv;

d("Studio auth_* schema (P8-T8.2)", () => {
  let pool: Pool;

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
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM auth_user WHERE email LIKE 'p8t8%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates all four auth_* tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'auth_%' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "auth_account",
      "auth_session",
      "auth_user",
      "auth_verification",
    ]);
  });

  it("preserves Better-auth's camelCase column names (quoted identifiers)", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'auth_user'`,
    );
    const cols = rows.map((r) => r.column_name);
    // Postgres stores these case-preserved only because they were created
    // quoted; an unquoted DDL would have folded them to lowercase.
    expect(cols).toContain("emailVerified");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("Better-auth's adapter round-trips a user against the migrated columns", async () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    const ctx = await auth.$context;
    const adapter = ctx.adapter;

    const email = `p8t82-${Date.now()}@anchorcorps.com`;
    const created = await adapter.create<{
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
    }>({
      model: "user",
      data: { name: "P8 T8.2 Probe", email, emailVerified: true },
    });
    expect(created.id).toBeTruthy();
    expect(created.email).toBe(email);

    const found = await adapter.findOne<{ id: string; email: string; emailVerified: boolean }>({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    expect(found?.id).toBe(created.id);
    expect(found?.emailVerified).toBe(true);

    await adapter.delete({ model: "user", where: [{ field: "id", value: created.id }] });
    const gone = await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    expect(gone).toBeNull();
  });

  // P8-T8.3 — the team gate must fire through Better-auth's REAL create
  // pipeline (databaseHooks.user.create.before), not just the pure predicate.
  it("team gate blocks a non-Workspace email at user creation", async () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    const ctx = await auth.$context;
    await expect(
      ctx.internalAdapter.createUser({
        email: `p8t83-outsider-${Date.now()}@gmail.com`,
        name: "Outsider",
        emailVerified: false,
      }),
    ).rejects.toThrow();
  });

  it("team gate allows a Workspace email at user creation", async () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    const ctx = await auth.$context;
    const email = `p8t83-team-${Date.now()}@anchorcorps.com`;
    const user = await ctx.internalAdapter.createUser({
      email,
      name: "Teammate",
      emailVerified: false,
    });
    expect(user).toBeTruthy();
  });
});
