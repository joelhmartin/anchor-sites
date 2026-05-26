import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { z } from "zod";
import { pluginsRouter } from "../../src/server/routes/plugins.js";
import { __resetPluginsForTests, registerPlugin } from "../../src/server/plugins/registry.js";

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", pluginsRouter({ pool }));
  return app;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const TOKEN = "plugins-api-test-token";
const SECRET = "sk-secret-DO-NOT-LEAK";

d("admin plugins API (P7.5-T7.5.6)", () => {
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
    process.env.ADMIN_API_TOKEN = TOKEN;

    __resetPluginsForTests();
    registerPlugin({
      name: "apitest",
      version: "2.0.0",
      configSchema: z.object({
        label: z.string().default(""),
        api_key: z.string().default(""),
      }),
      secretConfigKeys: ["api_key"],
    });

    const res = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('plgapi', 'Plg API') RETURNING id`,
    );
    siteId = res.rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'plgapi'`).catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
    __resetPluginsForTests();
    await pool.end().catch(() => undefined);
  });

  const auth = (r: request.Test) => r.set("x-admin-token", TOKEN);

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/plugins");
    expect(res.status).toBe(401);
  });

  it("lists available plugins with config schema + secret key names", async () => {
    const res = await auth(request(app).get("/api/plugins"));
    expect(res.status).toBe(200);
    const apitest = res.body.plugins.find((p: { name: string }) => p.name === "apitest");
    expect(apitest).toBeTruthy();
    expect(apitest.version).toBe("2.0.0");
    expect(apitest.secret_config_keys).toEqual(["api_key"]);
    expect(apitest.config_schema).toBeTruthy();
  });

  it("installs+enables with config, encrypting the secret and never echoing it", async () => {
    const res = await auth(
      request(app)
        .put(`/api/sites/${siteId}/plugins/apitest`)
        .send({ enabled: true, config: { label: "Hello", api_key: SECRET } }),
    );
    expect(res.status).toBe(200);
    expect(res.body.plugin.enabled).toBe(true);
    expect(res.body.plugin.config).toEqual({ label: "Hello" });
    expect(res.body.plugin.secrets_set).toEqual(["api_key"]);
    // The secret value is not in the response anywhere.
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    // And it's encrypted at rest — the stored blob doesn't contain plaintext.
    const row = await pool.query<{ config: unknown; config_encrypted: unknown }>(
      `SELECT config, config_encrypted FROM site_plugins WHERE site_id = $1 AND plugin_name = 'apitest'`,
      [siteId],
    );
    expect(JSON.stringify(row.rows[0].config_encrypted)).not.toContain(SECRET);
    expect(row.rows[0].config).toEqual({ label: "Hello" });
  });

  it("reports per-site state with secrets redacted", async () => {
    const res = await auth(request(app).get(`/api/sites/${siteId}/plugins`));
    expect(res.status).toBe(200);
    const p = res.body.plugins.find((x: { plugin_name: string }) => x.plugin_name === "apitest");
    expect(p.enabled).toBe(true);
    expect(p.secrets_set).toEqual(["api_key"]);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("disables while preserving config", async () => {
    const res = await auth(
      request(app).put(`/api/sites/${siteId}/plugins/apitest`).send({ enabled: false }),
    );
    expect(res.status).toBe(200);
    expect(res.body.plugin.enabled).toBe(false);
    expect(res.body.plugin.config).toEqual({ label: "Hello" });
    expect(res.body.plugin.secrets_set).toEqual(["api_key"]); // preserved
  });

  it("preserves an existing secret when a later config save omits it", async () => {
    // api_key was set earlier. Re-save config without resending it.
    const res = await auth(
      request(app)
        .put(`/api/sites/${siteId}/plugins/apitest`)
        .send({ config: { label: "Renamed", api_key: "" } }),
    );
    expect(res.status).toBe(200);
    expect(res.body.plugin.config).toEqual({ label: "Renamed" });
    expect(res.body.plugin.secrets_set).toEqual(["api_key"]); // still set
  });

  it("rejects config that fails the plugin schema", async () => {
    const res = await auth(
      request(app).put(`/api/sites/${siteId}/plugins/apitest`).send({ config: { label: 123 } }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid plugin config/);
  });

  it("404s an unregistered plugin", async () => {
    const res = await auth(
      request(app).put(`/api/sites/${siteId}/plugins/ghost`).send({ enabled: true }),
    );
    expect(res.status).toBe(404);
  });

  it("404s an unknown site", async () => {
    const res = await auth(
      request(app)
        .put(`/api/sites/00000000-0000-0000-0000-000000000000/plugins/apitest`)
        .send({ enabled: true }),
    );
    expect(res.status).toBe(404);
  });
});
