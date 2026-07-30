import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { adminTenantRouter } from "../../src/server/routes/admin-tenant.js";

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminTenantRouter({ pool }));
  return app;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const TOKEN = "admin-tenant-members-test-token";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function seedMember(pool: Pool, siteId: string, id: string, email: string) {
  await pool.query(
    `INSERT INTO tenant_auth_user (id, site_id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, true, now(), now())`,
    [id, siteId, email.split("@")[0], email],
  );
}

d("admin tenant members/auth-config API (P8-T8.13)", () => {
  let pool: Pool;
  let siteId: string;
  let otherId: string;
  let app: express.Express;

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
      `INSERT INTO sites (slug, display_name) VALUES ('atmem', 'AT Mem') RETURNING id`,
    );
    siteId = a.rows[0].id;
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('atmem-other', 'Other') RETURNING id`,
    );
    otherId = b.rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  // vi.stubEnv (not a raw `process.env` write) so vitest's `unstubEnvs`
  // hygiene (vitest.workspace.ts) guarantees this is reset before the NEXT
  // test runs — anywhere in the suite — regardless of how long this file's
  // own `afterAll` (real Postgres queries, `pool.end()`) takes. A raw
  // `process.env.ADMIN_API_TOKEN = …` set once in `beforeAll` and deleted
  // once in `afterAll` depended on that `afterAll` finishing before the next
  // file's hooks ran; when it didn't, the stale/missing token leaked into
  // whichever admin-gated request happened to be in flight next (root cause
  // of the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug IN ('atmem','atmem-other')`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  const auth = (r: request.Test) => r.set("x-admin-token", TOKEN);

  it("requires admin auth", async () => {
    expect((await request(app).get(`/api/sites/${siteId}/members`)).status).toBe(401);
    expect((await request(app).get(`/api/sites/${siteId}/auth-config`)).status).toBe(401);
  });

  it("404s an unknown site", async () => {
    expect((await auth(request(app).get(`/api/sites/${NIL_UUID}/members`))).status).toBe(404);
    expect((await auth(request(app).get(`/api/sites/${NIL_UUID}/auth-config`))).status).toBe(404);
  });

  it("lists only this site's members (site-scoped)", async () => {
    await seedMember(pool, siteId, "mem-mine", "mine@x.test");
    await seedMember(pool, otherId, "mem-other", "other@x.test");
    const res = await auth(request(app).get(`/api/sites/${siteId}/members`));
    expect(res.status).toBe(200);
    const emails = res.body.members.map((m: { email: string }) => m.email);
    expect(emails).toContain("mine@x.test");
    expect(emails).not.toContain("other@x.test");
    expect(res.body.members[0].email_verified).toBe(true);
  });

  it("reads the default providers when the site has no config row", async () => {
    // 'other' site was created by raw INSERT (no copy-in) → no config row.
    const res = await auth(request(app).get(`/api/sites/${otherId}/auth-config`));
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual({ emailPassword: true });
  });

  it("sets and re-reads per-site providers (upsert)", async () => {
    const put = await auth(
      request(app).put(`/api/sites/${siteId}/auth-config`).send({ providers: { emailPassword: false } }),
    );
    expect(put.status).toBe(200);
    expect(put.body.providers).toEqual({ emailPassword: false });

    const get = await auth(request(app).get(`/api/sites/${siteId}/auth-config`));
    expect(get.body.providers).toEqual({ emailPassword: false });

    // upsert again (row already exists)
    const put2 = await auth(
      request(app).put(`/api/sites/${siteId}/auth-config`).send({ providers: { emailPassword: true } }),
    );
    expect(put2.body.providers).toEqual({ emailPassword: true });
  });

  it("400s unknown provider keys (strict)", async () => {
    const res = await auth(
      request(app).put(`/api/sites/${siteId}/auth-config`).send({ providers: { google: true } }),
    );
    expect(res.status).toBe(400);
  });
});
