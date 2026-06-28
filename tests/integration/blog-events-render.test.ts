import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../db/seed.js";
import { blogEventsRouter } from "../../src/server/routes/blog-events.js";
import { pageRouter } from "../../src/server/routes/page.js";
import { createPost } from "../../src/server/blog/repo.js";
import { createEvent } from "../../src/server/events/repo.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const HOST = "muldoon-dental.sites.anchorcorps.com";
const BODY = [{ id: "r1", type: "rich-text", props: { html: "<p>Hello world body</p>" } }];

function buildApp(pool: Pool): express.Express {
  const app = express();
  app.use(blogEventsRouter({ pool }));
  app.use(pageRouter({ pool }));
  app.use((_req, res) => res.status(200).type("text/plain").send("DOWNSTREAM"));
  return app;
}

d("public blog/events rendering (P8-T8.11)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;

  beforeAll(async () => {
    await migrate({ databaseUrl: TEST_DB_URL!, dir: MIGRATIONS_DIR, migrationsTable: "pgmigrations", direction: "up", count: Infinity, log: () => undefined });
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug = 'muldoon-dental'`);
    siteId = r.rows[0].id;
    await pool.query(`DELETE FROM posts WHERE site_id = $1 AND slug IN ('hello-world','secret-draft')`, [siteId]);
    await pool.query(`DELETE FROM events WHERE site_id = $1 AND slug = 'launch'`, [siteId]);
    await createPost(pool, siteId, { slug: "hello-world", title: "Hello World", excerpt: "First post", body: BODY, status: "published" });
    await createPost(pool, siteId, { slug: "secret-draft", title: "Secret", body: BODY, status: "draft" });
    await createEvent(pool, siteId, { slug: "launch", title: "Launch Party", description: BODY, starts_at: new Date("2026-08-01T18:00:00Z"), location: "HQ", status: "published" });
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM posts WHERE site_id = $1 AND slug IN ('hello-world','secret-draft')`, [siteId]).catch(() => undefined);
    await pool.query(`DELETE FROM events WHERE site_id = $1 AND slug = 'launch'`, [siteId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => __clearResolveSiteCacheForTests());

  it("/blog lists published posts (not drafts) on the tenant host", async () => {
    const res = await request(app).get("/blog").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("/blog/hello-world");
    expect(res.text).toContain("Hello World");
    expect(res.text).not.toContain("secret-draft");
  });

  it("/blog/:slug renders the post body through the block renderer", async () => {
    const res = await request(app).get("/blog/hello-world").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Hello world body");
    expect(res.text).toContain("ac-rich-text");
  });

  it("/blog/:slug emits BlogPosting JSON-LD + a self canonical (P9-T9.4)", async () => {
    const res = await request(app).get("/blog/hello-world").set("Host", HOST);
    expect(res.text).toContain('"@type":"BlogPosting"');
    expect(res.text).toContain('"headline":"Hello World"');
    expect(res.text).toContain(
      '<link rel="canonical" href="https://muldoon-dental.sites.anchorcorps.com/blog/hello-world" />',
    );
  });

  it("a draft post is not publicly reachable (404)", async () => {
    const res = await request(app).get("/blog/secret-draft").set("Host", HOST);
    expect(res.status).toBe(404);
  });

  it("/events lists published events and /events/:slug renders one", async () => {
    const list = await request(app).get("/events").set("Host", HOST);
    expect(list.status).toBe(200);
    expect(list.text).toContain("Launch Party");
    expect(list.text).toContain("/events/launch");

    const detail = await request(app).get("/events/launch").set("Host", HOST);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain("Hello world body");
    // P9-T9.4 — Event JSON-LD with startDate + Place location
    expect(detail.text).toContain('"@type":"Event"');
    expect(detail.text).toContain('"startDate":"2026-08-01');
    expect(detail.text).toContain('"location":{"@type":"Place","name":"HQ"}');
  });

  it("falls through on an unknown host (does not hijack non-tenant requests)", async () => {
    const res = await request(app).get("/blog").set("Host", "nobody.example.com");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });
});
