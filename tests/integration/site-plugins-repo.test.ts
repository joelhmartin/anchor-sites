import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import {
  upsertSitePlugin,
  listSitePlugins,
  getSitePlugin,
  getEnabledPlugins,
  setEnabled,
  setConfig,
  type EncryptedEnvelope,
} from "../../src/server/plugins/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

const envelope: EncryptedEnvelope = {
  v: 1,
  iv: "aXYtYmFzZTY0",
  tag: "dGFnLWJhc2U2NA==",
  ciphertext: "Y2lwaGVy",
};

d("site_plugins repository (integration)", () => {
  let pool: Pool;
  let siteId: string;
  let otherSiteId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    const a = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgtest-a', 'Plg A') RETURNING id`,
    );
    siteId = a.rows[0].id;
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgtest-b', 'Plg B') RETURNING id`,
    );
    otherSiteId = b.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    // CASCADE from sites drops the site_plugins rows.
    await pool.query(`DELETE FROM sites WHERE slug LIKE 'plgtest-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("installs a plugin row with defaults", async () => {
    const row = await upsertSitePlugin(
      { siteId, pluginName: "example", version: "1.0.0" },
      { pool },
    );
    expect(row.plugin_name).toBe("example");
    expect(row.version).toBe("1.0.0");
    expect(row.enabled).toBe(false);
    expect(row.config).toEqual({});
    expect(row.config_encrypted).toBeNull();
    expect(row.installed_at).toBeInstanceOf(Date);
  });

  it("upsert is idempotent on (site_id, plugin_name) and updates the full state", async () => {
    await upsertSitePlugin({ siteId, pluginName: "example", version: "1.0.0" }, { pool });
    const updated = await upsertSitePlugin(
      {
        siteId,
        pluginName: "example",
        version: "1.1.0",
        enabled: true,
        config: { region: "us" },
        configEncrypted: envelope,
      },
      { pool },
    );
    expect(updated.version).toBe("1.1.0");
    expect(updated.enabled).toBe(true);
    expect(updated.config).toEqual({ region: "us" });
    expect(updated.config_encrypted).toEqual(envelope);

    // Still exactly one row for the pair.
    const all = await listSitePlugins(siteId, { pool });
    expect(all.filter((r) => r.plugin_name === "example")).toHaveLength(1);
  });

  it("getSitePlugin returns the row or null", async () => {
    expect(await getSitePlugin(siteId, "example", { pool })).not.toBeNull();
    expect(await getSitePlugin(siteId, "does-not-exist", { pool })).toBeNull();
  });

  it("getEnabledPlugins returns only enabled plugins as {name, version}", async () => {
    await upsertSitePlugin(
      { siteId, pluginName: "disabled-one", version: "0.1.0", enabled: false },
      { pool },
    );
    const enabled = await getEnabledPlugins(siteId, { pool });
    expect(enabled).toContainEqual({ name: "example", version: "1.1.0" });
    expect(enabled.find((p) => p.name === "disabled-one")).toBeUndefined();
  });

  it("setEnabled toggles, setConfig replaces and can clear secrets", async () => {
    const off = await setEnabled(siteId, "example", false, { pool });
    expect(off?.enabled).toBe(false);
    expect(await getEnabledPlugins(siteId, { pool })).not.toContainEqual({
      name: "example",
      version: "1.1.0",
    });

    const cfg = await setConfig(siteId, "example", { region: "eu" }, null, { pool });
    expect(cfg?.config).toEqual({ region: "eu" });
    expect(cfg?.config_encrypted).toBeNull();

    // Targeted writers no-op (null) on a plugin that isn't installed.
    expect(await setEnabled(siteId, "ghost", true, { pool })).toBeNull();
    expect(await setConfig(siteId, "ghost", {}, null, { pool })).toBeNull();
  });

  it("scopes rows per site", async () => {
    await upsertSitePlugin({ siteId: otherSiteId, pluginName: "example", version: "2.0.0" }, { pool });
    const a = await getSitePlugin(siteId, "example", { pool });
    const b = await getSitePlugin(otherSiteId, "example", { pool });
    expect(a?.version).toBe("1.1.0");
    expect(b?.version).toBe("2.0.0");
  });

  it("enforces the (site_id, plugin_name) unique constraint on raw insert", async () => {
    await expect(
      pool.query(
        `INSERT INTO site_plugins (site_id, plugin_name, version) VALUES ($1, 'example', '9.9.9')`,
        [siteId],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("cascades when the site is deleted", async () => {
    const tmp = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgtest-cascade', 'C') RETURNING id`,
    );
    const tmpId = tmp.rows[0].id;
    await upsertSitePlugin({ siteId: tmpId, pluginName: "example", version: "1.0.0" }, { pool });
    await pool.query(`DELETE FROM sites WHERE id = $1`, [tmpId]);
    const rows = await listSitePlugins(tmpId, { pool });
    expect(rows).toHaveLength(0);
  });
});
