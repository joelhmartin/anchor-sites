import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { hasBlock } from "../../src/blocks/registry.js";
import { __resetPluginsForTests, registerPlugin } from "../../src/server/plugins/registry.js";
import { loadPlugins } from "../../src/server/plugins/loader.js";
import { exampleManifest } from "../../src/server/plugins/example/manifest.js";
import { setEnabled, upsertSitePlugin } from "../../src/server/plugins/repo.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const HOST = "plgex.sites.anchorcorps.com";

d("reference plugin end-to-end (P7.5-T7.5.7)", () => {
  let pool: Pool;
  let siteId: string;
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
    const res = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgex', 'Plg Example') RETURNING id`,
    );
    siteId = res.rows[0].id;

    __resetPluginsForTests();
    registerPlugin(exampleManifest);

    app = express();
    app.use(express.json());
    loadPlugins(app, { pool });
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'plgex'`).catch(() => undefined);
    __resetPluginsForTests();
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => __clearResolveSiteCacheForTests());

  it("registers the namespaced block from the manifest", () => {
    expect(hasBlock("example/banner")).toBe(true);
  });

  it("403s the plugin route when the plugin is not enabled for the site", async () => {
    await pool.query(`DELETE FROM site_plugins WHERE site_id = $1`, [siteId]);
    __clearResolveSiteCacheForTests();
    const res = await request(app).get("/api/plugins/example/ping").set("Host", HOST);
    expect(res.status).toBe(403);
  });

  it("404s when the host resolves to no site", async () => {
    const res = await request(app)
      .get("/api/plugins/example/ping")
      .set("Host", "no-such-site.sites.anchorcorps.com");
    expect(res.status).toBe(404);
  });

  it("serves the route + echoes non-secret config when enabled", async () => {
    await upsertSitePlugin(
      { siteId, pluginName: "example", version: "1.0.0", enabled: true, config: { greeting: "howdy" } },
      { pool },
    );
    __clearResolveSiteCacheForTests();
    const res = await request(app).get("/api/plugins/example/ping").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, plugin: "example", site: "plgex", greeting: "howdy" });
  });

  it("uses its owned plg_example_notes table (POST then GET)", async () => {
    await upsertSitePlugin(
      { siteId, pluginName: "example", version: "1.0.0", enabled: true },
      { pool },
    );
    __clearResolveSiteCacheForTests();

    const post = await request(app)
      .post("/api/plugins/example/notes")
      .set("Host", HOST)
      .send({ note: "first note" });
    expect(post.status).toBe(201);
    expect(post.body.note.note).toBe("first note");

    const list = await request(app).get("/api/plugins/example/notes").set("Host", HOST);
    expect(list.status).toBe(200);
    expect(list.body.notes.map((n: { note: string }) => n.note)).toContain("first note");
  });

  it("stops serving the route after the plugin is disabled", async () => {
    await setEnabled(siteId, "example", false, { pool });
    __clearResolveSiteCacheForTests();
    const res = await request(app).get("/api/plugins/example/ping").set("Host", HOST);
    expect(res.status).toBe(403);
  });
});
