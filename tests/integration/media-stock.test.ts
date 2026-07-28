import express from "express";
import request from "supertest";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAgentDb } from "../helpers/agent-db.js";
import { mediaRouter, type MediaRouterOptions } from "../../src/server/routes/media.js";

/**
 * Task 8 (inline editing): operator stock-search/import endpoints.
 *
 *   POST /api/sites/:siteId/media/stock-search
 *   POST /api/sites/:siteId/media/stock-import
 *
 * Mirrors the per-router pattern in media-upload-url.test.ts, but uses
 * setupAgentDb/seedSite (tests/helpers/agent-db.ts) rather than the fixed
 * `muldoon-dental` seed site, since these routes don't touch the fixture
 * data at all.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-media-stock";

function buildApp(pool: Pool, opts: Pick<MediaRouterOptions, "searchFn" | "ingestFn"> = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    mediaRouter({
      pool,
      uploadRateLimit: { max: 100, windowMs: 60_000 },
      ...opts,
    }),
  );
  return app;
}

d("POST /api/sites/:siteId/media/stock-search + stock-import (Task 8)", () => {
  const db = setupAgentDb();
  let pool: Pool;
  let siteId: string;
  let app: express.Express;

  beforeAll(async () => {
    await db.runMigrations();
    pool = db.getPool();
    const site = await db.seedSite("media-stock");
    siteId = site.id;
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    delete process.env.ADMIN_API_TOKEN;
    await db.teardown();
  });

  describe("stock-search", () => {
    it("401 without admin token", async () => {
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-search`)
        .send({ query: "dentist" });
      expect(r.status).toBe(401);
    });

    it("400 on invalid payload (query too short)", async () => {
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-search`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ query: "a" });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid payload");
    });

    it("404 when site does not exist", async () => {
      const r = await request(app)
        .post(`/api/sites/00000000-0000-0000-0000-000000000000/media/stock-search`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ query: "dentist" });
      expect(r.status).toBe(404);
    });

    it("stub-mode search returns 3 hits mapped to preview/download_url/credit shape", async () => {
      // No PIXABAY_API_KEY in the test env, so searchPixabay runs in stub
      // mode — real function, no injection needed, no network touched.
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-search`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ query: "dentist office", per_page: 5 });
      expect(r.status).toBe(200);
      expect(r.body.mode).toBe("stub");
      expect(r.body.hits).toHaveLength(3);
      for (const hit of r.body.hits) {
        expect(hit).toMatchObject({
          id: expect.any(Number),
          tags: expect.any(String),
          preview: expect.any(String),
          download_url: expect.any(String),
          width: expect.any(Number),
          height: expect.any(Number),
          credit: expect.any(String),
        });
      }
    });

    it("passes query + per_page through to the injected searchFn", async () => {
      const searchFn = vi.fn(async () => ({
        mode: "api" as const,
        hits: [
          {
            id: 1,
            tags: "cat",
            previewURL: "https://cdn.example/prev.jpg",
            largeImageURL: "https://cdn.example/full.jpg",
            imageWidth: 640,
            imageHeight: 480,
            user: "photographer",
            pageURL: "https://example.com/1",
          },
        ],
      }));
      const spyApp = buildApp(pool, { searchFn });
      const r = await request(spyApp)
        .post(`/api/sites/${siteId}/media/stock-search`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ query: "cats", per_page: 4 });
      expect(r.status).toBe(200);
      expect(searchFn).toHaveBeenCalledWith("cats", { perPage: 4 });
      expect(r.body).toEqual({
        mode: "api",
        hits: [
          {
            id: 1,
            tags: "cat",
            preview: "https://cdn.example/prev.jpg",
            download_url: "https://cdn.example/full.jpg",
            width: 640,
            height: 480,
            credit: "photographer",
          },
        ],
      });
    });
  });

  describe("stock-import", () => {
    it("401 without admin token", async () => {
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-import`)
        .send({ url: "https://example.com/x.jpg", alt: "A cat" });
      expect(r.status).toBe(401);
    });

    it("400 on invalid payload (bad url, short alt)", async () => {
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-import`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ url: "not-a-url", alt: "ab" });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid payload");
    });

    it("404 when site does not exist", async () => {
      const r = await request(app)
        .post(`/api/sites/00000000-0000-0000-0000-000000000000/media/stock-import`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ url: "https://example.com/x.jpg", alt: "A cat" });
      expect(r.status).toBe(404);
    });

    it("202 + asset_id via injected ingestFn spy", async () => {
      const ingestFn = vi.fn(async () => ({
        asset_id: "11111111-1111-1111-1111-111111111111",
        gcs_key: `originals/${siteId}/11111111-1111-1111-1111-111111111111.jpg`,
      }));
      const spyApp = buildApp(pool, { ingestFn });
      const r = await request(spyApp)
        .post(`/api/sites/${siteId}/media/stock-import`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ url: "https://example.com/x.jpg", alt: "A cat photo" });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ asset_id: "11111111-1111-1111-1111-111111111111" });
      expect(ingestFn).toHaveBeenCalledWith(pool, {
        siteId,
        url: "https://example.com/x.jpg",
        alt: "A cat photo",
      });
    });

    it("400 with guard message when the real ingest rejects a non-https url", async () => {
      // No ingestFn override — exercises the real ingestImageFromUrl, whose
      // assertSafeImageUrl guard rejects non-https before any network call.
      const r = await request(app)
        .post(`/api/sites/${siteId}/media/stock-import`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ url: "http://example.com/x.jpg", alt: "A cat photo" });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: "invalid payload",
        details: [{ path: "url", message: "image url must use https" }],
      });
    });
  });
});
