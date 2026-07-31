import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTenantAuth,
  tenantSecret,
  __resetTenantAuthForTests,
} from "../../src/server/auth/tenant-auth.js";

/**
 * P8-T8.8 — per-site Better-auth must isolate by `site_id` (D-048). Two sites
 * with the same member email must not see each other's rows. We drive each
 * site's scoped adapter directly (the instance's `database` IS the scoped
 * adapter) and assert: `site_id` is auto-injected on create, the same email is
 * allowed in both sites, and a lookup in one site never returns the other's
 * user — even by the other's primary key.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

type Adapter = {
  create: (a: unknown) => Promise<{ id: string; site_id: string; email: string }>;
  findOne: (a: unknown) => Promise<{ id: string; site_id: string } | null>;
};

d("per-site tenant auth isolation (P8-T8.8)", () => {
  let pool: Pool;
  let siteA: string;
  let siteB: string;
  let adapterA: Adapter;
  let adapterB: Adapter;

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
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t88-a','A','{}'::jsonb) RETURNING id`,
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t88-b','B','{}'::jsonb) RETURNING id`,
    );
    siteA = a.rows[0].id;
    siteB = b.rows[0].id;
    __resetTenantAuthForTests();
    const authA = await getTenantAuth(siteA, { pool });
    const authB = await getTenantAuth(siteB, { pool });
    adapterA = (await authA.$context).adapter as unknown as Adapter;
    adapterB = (await authB.$context).adapter as unknown as Adapter;
  }, 60_000);

  afterAll(async () => {
    __resetTenantAuthForTests();
    await pool.query(`DELETE FROM sites WHERE slug IN ('p8t88-a','p8t88-b')`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("auto-injects site_id on create and allows the same email in both sites", async () => {
    const ua = await adapterA.create({
      model: "user",
      data: { name: "A member", email: "member@shared.test", emailVerified: false },
    });
    const ub = await adapterB.create({
      model: "user",
      data: { name: "B member", email: "member@shared.test", emailVerified: false },
    });
    expect(ua.site_id).toBe(siteA);
    expect(ub.site_id).toBe(siteB);
    expect(ua.id).not.toBe(ub.id);
  });

  it("a lookup in one site never returns the other site's user", async () => {
    const foundInA = await adapterA.findOne({
      model: "user",
      where: [{ field: "email", value: "member@shared.test" }],
    });
    const foundInB = await adapterB.findOne({
      model: "user",
      where: [{ field: "email", value: "member@shared.test" }],
    });
    expect(foundInA?.site_id).toBe(siteA);
    expect(foundInB?.site_id).toBe(siteB);
    expect(foundInA?.id).not.toBe(foundInB?.id);

    // Cross-site: site A's instance must NOT find site B's user even by its id.
    const crossed = await adapterA.findOne({
      model: "user",
      where: [{ field: "id", value: foundInB!.id }],
    });
    expect(crossed).toBeNull();
  });
});

// D812 (W2-SEC) — tenant auth is DORMANT (zero non-test consumers). The old
// tenantSecret silently fell back to a hardcoded, repo-public string; a
// production mount without config would have signed real visitor sessions
// with a known key. Now production fails loudly, dev/test keep working.
describe("tenantSecret hard-fails in production without BETTER_AUTH_SECRET (D812)", () => {
  it("prefers BETTER_AUTH_SECRET whenever set", () => {
    expect(tenantSecret({ BETTER_AUTH_SECRET: "real-secret", NODE_ENV: "production" })).toBe(
      "real-secret",
    );
  });

  it("throws in production when the secret is missing", () => {
    expect(() => tenantSecret({ NODE_ENV: "production" })).toThrowError(/BETTER_AUTH_SECRET/);
  });

  it("keeps the dev fallback outside production", () => {
    expect(tenantSecret({ NODE_ENV: "test" })).toBe("dev-tenant-auth-secret-please-set-in-prod");
  });

  it("getTenantAuth rejects before any adapter work on a misconfigured prod env", async () => {
    __resetTenantAuthForTests();
    await expect(
      getTenantAuth("deadbeef-dead-4dea-8dea-deadbeefdead", {
        env: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrowError(/BETTER_AUTH_SECRET/);
  });
});
