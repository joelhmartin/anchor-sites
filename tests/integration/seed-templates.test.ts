import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seedTemplates } from "../../db/seed-templates.js";
import { listTemplates, getTemplate } from "../../src/server/templates/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction, count, log: () => undefined });

d("seed-templates (integration, P7-T7.7)", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    // Start clean so counts are unambiguous regardless of other files' state.
    await pool.query(`DELETE FROM templates WHERE slug = 'starter'`);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM templates WHERE slug = 'starter'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates the starter template with valid, ordered pages", async () => {
    const res = await seedTemplates(pool);
    expect(res.templates).toBeGreaterThanOrEqual(1);

    const list = await listTemplates({ pool, kind: "site" });
    const starter = list.find((t) => t.slug === "starter");
    expect(starter).toBeDefined();
    expect(starter!.pages_count).toBe(2);

    const full = await getTemplate(starter!.id, { pool });
    expect(full!.pages.map((p) => p.slug)).toEqual(["home", "about"]);
    expect(full!.template.brand_tokens).toMatchObject({ "--theme-main": "#0a3d62" });
    expect(full!.template.category).toBe("Basic");
    expect(full!.template.sort_order).toBe(999);
  });

  it("is idempotent — re-running does not duplicate the template or its pages", async () => {
    await seedTemplates(pool);
    await seedTemplates(pool);

    const rows = await pool.query<{ count: string }>(`SELECT count(*) FROM templates WHERE slug = 'starter'`);
    expect(Number(rows.rows[0].count)).toBe(1);

    const starter = (await listTemplates({ pool, kind: "site" })).find((t) => t.slug === "starter")!;
    expect(starter.pages_count).toBe(2);
    // UPSERT keeps gallery metadata in sync on re-run (idempotence covers new fields too).
    expect(starter.category).toBe("Basic");
    expect(starter.sort_order).toBe(999);
  });
});
