import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { adminTenantRouter } from "../../src/server/routes/admin-tenant.js";

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminTenantRouter({ pool }));
  return app;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;
const TOKEN = "admin-tenant-blog-test-token";
const RT = [{ id: "x1", type: "rich-text", props: { html: "<p>hi</p>" } }];
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

d("admin tenant blog API (P8-T8.13)", () => {
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
    const res = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('atblog', 'AT Blog') RETURNING id`,
    );
    siteId = res.rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug = 'atblog'`).catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
    await pool.end().catch(() => undefined);
  });

  const auth = (r: request.Test) => r.set("x-admin-token", TOKEN);

  it("requires admin auth", async () => {
    const res = await request(app).get(`/api/sites/${siteId}/posts`);
    expect(res.status).toBe(401);
  });

  it("404s an unknown site on list + create", async () => {
    expect((await auth(request(app).get(`/api/sites/${NIL_UUID}/posts`))).status).toBe(404);
    expect(
      (await auth(request(app).post(`/api/sites/${NIL_UUID}/posts`).send({ slug: "x", title: "X" }))).status,
    ).toBe(404);
  });

  it("creates a draft post, lists it (body omitted), and reads it back in full", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "first", title: "First", body: RT }),
    );
    expect(created.status).toBe(201);
    expect(created.body.post.status).toBe("draft");
    expect(created.body.post.published_at).toBeNull();
    const postId = created.body.post.id as string;

    const list = await auth(request(app).get(`/api/sites/${siteId}/posts`));
    expect(list.status).toBe(200);
    const row = list.body.posts.find((p: { id: string }) => p.id === postId);
    expect(row).toBeTruthy();
    expect(row.body).toBeUndefined(); // list omits the heavy Block[]

    const full = await auth(request(app).get(`/api/sites/${siteId}/posts/${postId}`));
    expect(full.status).toBe(200);
    expect(full.body.post.body).toEqual(RT);
  });

  it("publishes via PUT (stamps published_at) and filters by status", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "pub", title: "Pub" }),
    );
    const postId = created.body.post.id as string;

    const upd = await auth(
      request(app).put(`/api/sites/${siteId}/posts/${postId}`).send({ status: "published" }),
    );
    expect(upd.status).toBe(200);
    expect(upd.body.post.status).toBe("published");
    expect(upd.body.post.published_at).not.toBeNull();

    const published = await auth(request(app).get(`/api/sites/${siteId}/posts?status=published`));
    expect(published.body.posts.some((p: { id: string }) => p.id === postId)).toBe(true);
    const drafts = await auth(request(app).get(`/api/sites/${siteId}/posts?status=draft`));
    expect(drafts.body.posts.some((p: { id: string }) => p.id === postId)).toBe(false);
  });

  it("409s a duplicate slug within the site", async () => {
    await auth(request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "dupe", title: "A" }));
    const res = await auth(
      request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "dupe", title: "B" }),
    );
    expect(res.status).toBe(409);
  });

  it("400s an invalid block body", async () => {
    const res = await auth(
      request(app)
        .post(`/api/sites/${siteId}/posts`)
        .send({ slug: "badbody", title: "Bad", body: [{ id: "n1", type: "no-such-block", props: {} }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body.failures?.length).toBeGreaterThan(0);
  });

  it("400s an invalid slug", async () => {
    const res = await auth(
      request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "Bad Slug", title: "X" }),
    );
    expect(res.status).toBe(400);
  });

  it("deletes a post and then 404s it", async () => {
    const created = await auth(
      request(app).post(`/api/sites/${siteId}/posts`).send({ slug: "gone", title: "Gone" }),
    );
    const postId = created.body.post.id as string;
    expect((await auth(request(app).delete(`/api/sites/${siteId}/posts/${postId}`))).status).toBe(204);
    expect((await auth(request(app).get(`/api/sites/${siteId}/posts/${postId}`))).status).toBe(404);
    expect((await auth(request(app).put(`/api/sites/${siteId}/posts/${postId}`).send({ title: "x" }))).status).toBe(404);
    expect((await auth(request(app).delete(`/api/sites/${siteId}/posts/${postId}`))).status).toBe(404);
  });

  it("does not read another site's post by id (site-scoped)", async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ('atblog-other', 'Other') RETURNING id`,
    );
    const otherId = other.rows[0].id;
    const created = await auth(
      request(app).post(`/api/sites/${otherId}/posts`).send({ slug: "secret", title: "Secret" }),
    );
    const otherPostId = created.body.post.id as string;
    // Ask for the other site's post id under OUR site → 404 (scoped).
    const res = await auth(request(app).get(`/api/sites/${siteId}/posts/${otherPostId}`));
    expect(res.status).toBe(404);
    await pool.query(`DELETE FROM sites WHERE slug = 'atblog-other'`).catch(() => undefined);
  });
});
