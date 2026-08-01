import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersRouter } from "../../src/server/routes/admin-users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const ADMIN_TOKEN = "test-admin-token-users";

beforeEach(() => {
  vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
});

const runMigrate = () =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: () => undefined,
  });

d("admin users offboarding (D522)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate();
    pool = new Pool({ connectionString: TEST_DB_URL });
    const a = express();
    a.use(express.json());
    a.use("/api", adminUsersRouter({ pool }));
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM auth_user WHERE email LIKE 'd522-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  async function makeUser(email: string) {
    const id = `d522-${Math.random().toString(36).slice(2)}`;
    await pool.query(
      `INSERT INTO auth_user (id, name, email) VALUES ($1, 'X', $2)`,
      [id, email],
    );
    // Give them a live session + an account (both CASCADE off auth_user).
    await pool.query(
      `INSERT INTO auth_session (id, "expiresAt", token, "userId")
       VALUES ($1, now() + interval '1 day', $2, $3)`,
      [`${id}-sess`, `${id}-tok`, id],
    );
    await pool.query(
      `INSERT INTO auth_account (id, "accountId", "providerId", "userId")
       VALUES ($1, $2, 'google', $3)`,
      [`${id}-acct`, `${id}-acct-ext`, id],
    );
    return id;
  }

  it("401 without token", async () => {
    const r = await request(app).delete(`/api/admin/users/whatever`);
    expect(r.status).toBe(401);
  });

  it("lists users with a live-session count", async () => {
    const id = await makeUser("d522-list@anchorcorps.com");
    const r = await request(app).get(`/api/admin/users`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    const u = r.body.users.find((x: { id: string }) => x.id === id);
    expect(u.active_sessions).toBe(1);
  });

  it("deleting a user cascades away their sessions + accounts (revokes access)", async () => {
    const id = await makeUser("d522-del@anchorcorps.com");
    const del = await request(app).delete(`/api/admin/users/${id}`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(del.status).toBe(200);
    expect(del.body.deleted.id).toBe(id);

    expect((await pool.query(`SELECT 1 FROM auth_user WHERE id = $1`, [id])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM auth_session WHERE "userId" = $1`, [id])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM auth_account WHERE "userId" = $1`, [id])).rowCount).toBe(0);
  });

  it("404 for an unknown user", async () => {
    const r = await request(app).delete(`/api/admin/users/nope`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });
});
