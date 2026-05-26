import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { z } from "zod";
import { blockManifest } from "@anchorcorps/components";
import {
  __resetRegistryForTests,
  hasBlock,
  registerBlock,
} from "../../src/blocks/registry.js";
import { richTextBlock } from "../../src/blocks/rich-text/index.js";
import { __resetPluginsForTests, registerPlugin } from "../../src/server/plugins/registry.js";
import { loadPlugins, verifyPluginMigrations } from "../../src/server/plugins/loader.js";
import type { PluginManifest } from "../../src/server/plugins/manifest.js";
import { createApp } from "../../src/server/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const happy = (): PluginManifest => ({
  name: "loadertest",
  version: "1.0.0",
  blocks: [
    {
      type: "loadertest/widget",
      schema: z.object({ text: z.string().default("hi") }),
      component: () => null,
      label: "Widget",
      description: "test widget",
      category: "content",
    },
  ],
  createRouter: (ctx) => {
    const r = Router();
    r.get("/ping", (_req, res) => res.json({ ok: true, plugin: ctx.pluginName }));
    return r;
  },
  migrations: { tables: ["plg_loadertest_items"] },
  configSchema: z.object({ region: z.string().default("us") }),
});

d("plugin loader (integration, P7.5-T7.5.4)", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrateUp();
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query(`CREATE TABLE IF NOT EXISTS plg_loadertest_items (id serial PRIMARY KEY)`);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS plg_loadertest_items`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  // Re-establish a known registry state from authoritative sources before each
  // test (same pattern as ai/catalog.test.ts) so cross-file order can't matter.
  beforeEach(() => {
    __resetRegistryForTests();
    for (const e of blockManifest) {
      const { type, ...rest } = e;
      registerBlock(type, rest);
    }
    registerBlock("rich-text", richTextBlock);
    __resetPluginsForTests();
  });

  it("verifyPluginMigrations marks env+table-ready plugins active, others skipped", async () => {
    registerPlugin(happy());
    registerPlugin({ name: "notmigrated", version: "1.0.0", migrations: { tables: ["plg_notmigrated_x"] } });
    registerPlugin({ name: "needsenv", version: "1.0.0", requiredEnv: ["LOADERTEST_MISSING_ENV"] });

    const { active, skipped } = await verifyPluginMigrations({ pool });
    expect(active).toEqual(["loadertest"]);
    expect(skipped).toContainEqual({ name: "notmigrated", reason: "missing tables: plg_notmigrated_x" });
    expect(skipped).toContainEqual(
      expect.objectContaining({ name: "needsenv", reason: expect.stringContaining("missing env") }),
    );
  });

  it("loadPlugins registers namespaced blocks and mounts the router", async () => {
    registerPlugin(happy());
    const app = express();
    const result = loadPlugins(app, { pool });

    expect(result.mounted).toContain("loadertest");
    expect(result.blocksRegistered).toContain("loadertest/widget");
    expect(hasBlock("loadertest/widget")).toBe(true);

    const res = await request(app).get("/api/plugins/loadertest/ping");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, plugin: "loadertest" });
  });

  it("block registration is idempotent across repeated loads", async () => {
    registerPlugin(happy());
    const app1 = express();
    const first = loadPlugins(app1, { pool });
    expect(first.blocksRegistered).toContain("loadertest/widget");

    const app2 = express();
    const second = loadPlugins(app2, { pool });
    expect(second.blocksRegistered).toEqual([]); // already registered — no throw
    expect(second.mounted).toContain("loadertest");
  });

  it("honors the `only` filter", async () => {
    registerPlugin(happy());
    registerPlugin({ name: "other", version: "1.0.0" });
    const app = express();
    const result = loadPlugins(app, { only: ["loadertest"], pool });
    expect(result.mounted).toEqual(["loadertest"]);
  });

  it("createApp mounts plugin routes before the catch-all renderer", async () => {
    registerPlugin(happy());
    const app = createApp({ activePlugins: ["loadertest"] });
    const res = await request(app).get("/api/plugins/loadertest/ping");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

function runMigrateUp() {
  return migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: () => undefined,
  });
}
