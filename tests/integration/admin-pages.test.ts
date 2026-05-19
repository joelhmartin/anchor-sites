import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

function buildApp(pool: Pool): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    adminPagesRouter({
      pool,
      // Looser limit during the multi-call test, generous in general.
      saveRateLimit: { max: 100, windowMs: 60_000 },
    }),
  );
  return app;
}

const validBlocks = (suffix = "") => [
  {
    id: "h1" + suffix,
    type: "hero",
    props: { title: "Saved hero " + suffix, align: "center" },
  },
  {
    id: "r1" + suffix,
    type: "rich-text",
    props: { html: "<p>Saved body " + suffix + "</p>", max_width: "medium" },
  },
];

d("admin pages API (integration)", () => {
  let pool: Pool;
  let app: express.Express;
  let muldoonSiteId: string;
  let muldoonPageId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);

    const r = await pool.query<{ id: string; page_id: string }>(
      `SELECT s.id, p.id AS page_id
         FROM sites s JOIN pages p ON p.site_id = s.id
        WHERE s.slug = 'muldoon-dental' AND p.slug = 'home'`,
    );
    muldoonSiteId = r.rows[0].id;
    muldoonPageId = r.rows[0].page_id;

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  beforeEach(async () => {
    // Clear revisions for muldoon home so each test starts at zero.
    await pool.query(`DELETE FROM page_revisions WHERE page_id = $1`, [muldoonPageId]);
  });

  // ---------- AUTH ----------

  it("rejects 401 when X-Admin-Token is missing", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .send({ blocks: validBlocks() });
    expect(res.status).toBe(401);
  });

  it("rejects 401 when X-Admin-Token is wrong", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", "wrong")
      .send({ blocks: validBlocks() });
    expect(res.status).toBe(401);
  });

  // ---------- SAVE ----------

  it("saving valid blocks creates a revision and returns it", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-A"), seo: { title: "New title" }, source: "test" });
    expect(res.status).toBe(200);
    expect(res.body.revision).toMatchObject({ id: expect.any(String) });
    expect(res.body.page).toMatchObject({ id: muldoonPageId, site_id: muldoonSiteId });

    const dbRev = await pool.query(
      `SELECT count(*) FROM page_revisions WHERE page_id = $1`,
      [muldoonPageId],
    );
    expect(Number(dbRev.rows[0].count)).toBe(1);

    const page = await pool.query<{ seo: Record<string, unknown>; blocks: unknown[] }>(
      `SELECT seo, blocks FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(page.rows[0].seo).toMatchObject({ title: "New title" });
    expect(page.rows[0].blocks).toHaveLength(2);
  });

  it("rejects invalid block props with 400 + structured failures", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({
        blocks: [
          // bad: max_width "huge" is not in the enum
          { id: "rx", type: "rich-text", props: { max_width: "huge" } },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("block validation failed");
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0]).toMatchObject({
      index: 0,
      id: "rx",
      type: "rich-text",
      reason: "invalid_props",
    });
  });

  it("rejects unknown block types with 400", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: [{ id: "u1", type: "ghost-block", props: {} }] });
    expect(res.status).toBe(400);
    expect(res.body.failures[0].reason).toBe("unknown_type");
  });

  it("404s when the page does not belong to the site", async () => {
    // muldoon page id under demo site id
    const demoRes = await pool.query<{ id: string }>(
      `SELECT id FROM sites WHERE slug = 'demo-site'`,
    );
    const res = await request(app)
      .post(`/api/sites/${demoRes.rows[0].id}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks() });
    expect(res.status).toBe(404);
  });

  // ---------- LIST ----------

  it("lists revisions in reverse chronological order", async () => {
    for (const tag of ["A", "B", "C"]) {
      const r = await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-" + tag), source: "save:" + tag });
      expect(r.status).toBe(200);
      // Small spacer so created_at values are distinguishable on fast hardware.
      await new Promise((r) => setTimeout(r, 5));
    }

    const list = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/revisions`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(list.status).toBe(200);
    expect(list.body.revisions).toHaveLength(3);
    const sources = list.body.revisions.map((r: { source: string }) => r.source);
    expect(sources).toEqual(["save:C", "save:B", "save:A"]);
  });

  // ---------- RESTORE ----------

  it("restoring an old revision creates a new revision (non-destructive)", async () => {
    // 1st save — the version we'll later restore.
    const first = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-first"), seo: { title: "First" } });
    expect(first.status).toBe(200);
    const firstRevId = first.body.revision.id;

    // 2nd save — different content.
    const second = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-second"), seo: { title: "Second" } });
    expect(second.status).toBe(200);

    // Restore 1st.
    const restored = await request(app)
      .post(
        `/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/revisions/${firstRevId}/restore`,
      )
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(restored.status).toBe(200);
    expect(restored.body.restored_from).toBe(firstRevId);

    // Revision count is 3, not 2 — restore appended a new row.
    const list = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/revisions`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(list.body.revisions).toHaveLength(3);
    expect(list.body.revisions[0].source).toMatch(/^restore:/);

    // Page now matches the restored content (first save).
    const page = await pool.query<{ blocks: { id: string }[]; seo: Record<string, unknown> }>(
      `SELECT blocks, seo FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(page.rows[0].seo).toMatchObject({ title: "First" });
    expect(page.rows[0].blocks[0].id).toBe("h1-first");
  });

  it("restore 404s when the revision belongs to a different page", async () => {
    // Seed a revision against demo page so the id exists but mismatches muldoon.
    const demo = await pool.query<{ id: string }>(
      `SELECT p.id FROM pages p JOIN sites s ON s.id = p.site_id
        WHERE s.slug = 'demo-site' AND p.slug = 'home'`,
    );
    const otherRev = await pool.query<{ id: string }>(
      `INSERT INTO page_revisions (page_id, blocks, seo, source)
       VALUES ($1, '[]'::jsonb, '{}'::jsonb, 'fixture') RETURNING id`,
      [demo.rows[0].id],
    );

    const res = await request(app)
      .post(
        `/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/revisions/${otherRev.rows[0].id}/restore`,
      )
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(404);
  });
});

d("admin pages rate limiting (integration)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;
  let pageId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);

    const r = await pool.query<{ id: string; page_id: string }>(
      `SELECT s.id, p.id AS page_id
         FROM sites s JOIN pages p ON p.site_id = s.id
        WHERE s.slug = 'muldoon-dental' AND p.slug = 'home'`,
    );
    siteId = r.rows[0].id;
    pageId = r.rows[0].page_id;

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    const a = express();
    a.use(express.json({ limit: "1mb" }));
    a.use(
      "/api",
      adminPagesRouter({
        pool,
        // Tiny bucket so the test can blow past it without 100 requests.
        saveRateLimit: { max: 2, windowMs: 60_000 },
      }),
    );
    app = a;
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
  });

  it("returns 429 after exceeding the configured budget", async () => {
    const url = `/api/sites/${siteId}/pages/${pageId}`;
    const headers = { "X-Admin-Token": ADMIN_TOKEN };

    const r1 = await request(app).post(url).set(headers).send({ blocks: validBlocks("-1") });
    expect(r1.status).toBe(200);
    const r2 = await request(app).post(url).set(headers).send({ blocks: validBlocks("-2") });
    expect(r2.status).toBe(200);
    const r3 = await request(app).post(url).set(headers).send({ blocks: validBlocks("-3") });
    expect(r3.status).toBe(429);
    expect(r3.headers["retry-after"]).toBeDefined();
  });
});
