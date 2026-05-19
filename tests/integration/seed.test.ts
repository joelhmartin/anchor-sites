import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { seed } from "../../db/seed.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("seed idempotency (integration)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("running seed twice does not duplicate rows", async () => {
    await seed(pool);
    const first = await pool.query<{ sites: string; pages: string }>(
      `SELECT (SELECT count(*) FROM sites)::text AS sites,
              (SELECT count(*) FROM pages)::text AS pages`,
    );

    await seed(pool);
    const second = await pool.query<{ sites: string; pages: string }>(
      `SELECT (SELECT count(*) FROM sites)::text AS sites,
              (SELECT count(*) FROM pages)::text AS pages`,
    );

    expect(second.rows[0]).toEqual(first.rows[0]);
    expect(Number(first.rows[0].sites)).toBeGreaterThanOrEqual(2);
    expect(Number(first.rows[0].pages)).toBeGreaterThanOrEqual(2);
  });

  it("seeds the two expected slugs", async () => {
    const res = await pool.query<{ slug: string }>(
      `SELECT slug FROM sites WHERE slug IN ('muldoon-dental', 'demo-site') ORDER BY slug`,
    );
    expect(res.rows.map((r) => r.slug)).toEqual(["demo-site", "muldoon-dental"]);
  });
});
