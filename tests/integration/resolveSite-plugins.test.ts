import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import {
  __clearResolveSiteCacheForTests,
  evictSiteCache,
  lookupSiteForDebug,
} from "../../src/middleware/resolveSite.js";
import { setEnabled, upsertSitePlugin } from "../../src/server/plugins/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const HOST = "plgresolve.sites.anchorcorps.com";

d("resolveSite populates req.site.plugins (P7.5-T7.5.5)", () => {
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
    const res = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgresolve', 'Plg Resolve') RETURNING id`,
    );
    siteId = res.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'plgresolve'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => __clearResolveSiteCacheForTests());

  it("resolves with no plugins when none are enabled", async () => {
    const { site } = await lookupSiteForDebug(pool, HOST);
    expect(site?.slug).toBe("plgresolve");
    expect(site?.plugins).toEqual([]);
  });

  it("includes an enabled plugin and excludes a disabled one", async () => {
    await upsertSitePlugin(
      { siteId, pluginName: "example", version: "1.2.0", enabled: true },
      { pool },
    );
    await upsertSitePlugin(
      { siteId, pluginName: "dormant", version: "0.1.0", enabled: false },
      { pool },
    );

    const { site } = await lookupSiteForDebug(pool, HOST);
    expect(site?.plugins).toContainEqual({ name: "example", version: "1.2.0" });
    expect(site?.plugins.find((p) => p.name === "dormant")).toBeUndefined();
  });

  it("reflects a disable after the host cache is evicted", async () => {
    await upsertSitePlugin(
      { siteId, pluginName: "example", version: "1.2.0", enabled: true },
      { pool },
    );
    // Warm the cache with the plugin enabled.
    let { site } = await lookupSiteForDebug(pool, HOST);
    expect(site?.plugins).toContainEqual({ name: "example", version: "1.2.0" });

    // Disable, then evict (what the admin route does) — stale cache would still
    // show it without the eviction.
    await setEnabled(siteId, "example", false, { pool });
    evictSiteCache(HOST);

    ({ site } = await lookupSiteForDebug(pool, HOST));
    expect(site?.plugins.find((p) => p.name === "example")).toBeUndefined();
  });
});
