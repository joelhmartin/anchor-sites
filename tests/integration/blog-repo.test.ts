import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPost,
  deletePost,
  getPostBySlug,
  InvalidPostBodyError,
  listPosts,
  PostSlugConflictError,
  updatePost,
} from "../../src/server/blog/repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const BODY = [{ id: "r1", type: "rich-text", props: { html: "<p>Hello</p>" } }];

d("blog repo (P8-T8.9)", () => {
  let pool: Pool;
  let siteA: string;
  let siteB: string;

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
    const a = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t89-a','A','{}'::jsonb) RETURNING id`,
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name, default_brand_tokens) VALUES ('p8t89-b','B','{}'::jsonb) RETURNING id`,
    );
    siteA = a.rows[0].id;
    siteB = b.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug IN ('p8t89-a','p8t89-b')`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates a draft (no published_at) and a published post (stamped)", async () => {
    const draft = await createPost(pool, siteA, { slug: "draft-1", title: "Draft", body: BODY });
    expect(draft.status).toBe("draft");
    expect(draft.published_at).toBeNull();

    const live = await createPost(pool, siteA, {
      slug: "live-1",
      title: "Live",
      body: BODY,
      status: "published",
    });
    expect(live.status).toBe("published");
    expect(live.published_at).not.toBeNull();
  });

  it("lists posts and filters by status", async () => {
    const all = await listPosts(pool, siteA);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const published = await listPosts(pool, siteA, { status: "published" });
    expect(published.every((p) => p.status === "published")).toBe(true);
  });

  it("stamps published_at on the draft→published transition", async () => {
    const created = await createPost(pool, siteA, { slug: "transition", title: "T", body: BODY });
    expect(created.published_at).toBeNull();
    const updated = await updatePost(pool, siteA, created.id, { status: "published" });
    expect(updated?.published_at).not.toBeNull();
    const reverted = await updatePost(pool, siteA, created.id, { status: "draft" });
    expect(reverted?.published_at).toBeNull();
  });

  it("rejects a duplicate slug within a site, allows it across sites", async () => {
    await createPost(pool, siteA, { slug: "dup", title: "A", body: BODY });
    await expect(createPost(pool, siteA, { slug: "dup", title: "A2", body: BODY })).rejects.toThrow(
      PostSlugConflictError,
    );
    // same slug, different site → OK
    const inB = await createPost(pool, siteB, { slug: "dup", title: "B", body: BODY });
    expect(inB.site_id).toBe(siteB);
  });

  it("rejects a body that fails registry validation", async () => {
    await expect(
      createPost(pool, siteA, {
        slug: "bad-body",
        title: "Bad",
        body: [{ id: "rx", type: "rich-text", props: { max_width: "huge" } }],
      }),
    ).rejects.toThrow(InvalidPostBodyError);
  });

  it("scopes reads by site_id", async () => {
    await createPost(pool, siteA, { slug: "only-a", title: "Only A", body: BODY });
    expect(await getPostBySlug(pool, siteA, "only-a")).not.toBeNull();
    expect(await getPostBySlug(pool, siteB, "only-a")).toBeNull();
  });

  it("deletes a post (scoped)", async () => {
    const p = await createPost(pool, siteA, { slug: "to-delete", title: "D", body: BODY });
    expect(await deletePost(pool, siteB, p.id)).toBe(false); // wrong site → no-op
    expect(await deletePost(pool, siteA, p.id)).toBe(true);
    expect(await getPostBySlug(pool, siteA, "to-delete")).toBeNull();
  });
});
