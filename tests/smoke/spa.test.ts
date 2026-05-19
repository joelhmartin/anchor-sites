import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { ViteDevServer } from "vite";
import { createApp } from "../../src/server/app.js";
import { mountViteDev } from "../../src/server/vite-dev.js";
import { pool } from "../../src/server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

describe("SPA index (Vite middleware mode)", () => {
  const app = createApp();
  let vite: ViteDevServer;

  beforeAll(async () => {
    vite = await mountViteDev(app, ROOT);
  }, 30_000);

  it("GET / returns 200 with the SPA root div", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('id="root"');
    expect(res.text).toContain("/@vite/client");
  });

  it("GET /healthz still works while Vite is mounted (route order)", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  afterAll(async () => {
    await vite?.close();
    await pool.end().catch(() => undefined);
  });
});
