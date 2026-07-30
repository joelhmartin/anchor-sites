import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
// then guarantees this resets before the next test anywhere in the suite,
// regardless of how long any describe's own `afterAll` takes (root cause of
// the cross-file requireAdmin flake — see
// .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
beforeEach(() => {
  vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
});

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

    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    // Restore muldoon home's brand_tokens_override to NULL — the
    // brand-tokens save tests persist values on shared seed data, which
    // would otherwise pollute page-render.test.ts (it asserts the site
    // default --theme-main). Cross-file isolation via cleanup here.
    await pool
      .query(`UPDATE pages SET brand_tokens_override = NULL WHERE id = $1`, [muldoonPageId])
      .catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(async () => {
    // Clear revisions + any leftover brand-token override so each test
    // starts from the seeded baseline.
    await pool.query(`DELETE FROM page_revisions WHERE page_id = $1`, [muldoonPageId]);
    await pool.query(`UPDATE pages SET brand_tokens_override = NULL WHERE id = $1`, [muldoonPageId]);
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

  // ---------- LOAD (single page with blocks) ----------

  it("GET returns the page with its blocks, seo, slug, title, status (P5-T5.5)", async () => {
    const res = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({
      id: muldoonPageId,
      site_id: muldoonSiteId,
      slug: "home",
    });
    expect(Array.isArray(res.body.page.blocks)).toBe(true);
    expect(res.body.page).toHaveProperty("seo");
    expect(res.body.page).toHaveProperty("status");
    expect(res.body.page).toHaveProperty("title");
  });

  it("GET 404s for a page id that doesn't belong to the site (P5-T5.5)", async () => {
    const res = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/00000000-0000-0000-0000-000000000000`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(404);
  });

  it("GET rejects 401 without a token (P5-T5.5)", async () => {
    const res = await request(app).get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`);
    expect(res.status).toBe(401);
  });

  // ---------- STATUS (publish/draft toggle) ----------

  it("save with `status` updates the page status; omitting leaves it unchanged (P5-T5.10)", async () => {
    const before = await pool.query<{ status: string }>(
      `SELECT status FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    const original = before.rows[0].status;
    try {
      const pub = await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-pub"), status: "published" });
      expect(pub.status).toBe(200);
      expect(pub.body.page.status).toBe("published");
      const db1 = await pool.query<{ status: string }>(`SELECT status FROM pages WHERE id = $1`, [muldoonPageId]);
      expect(db1.rows[0].status).toBe("published");

      // Omitting status leaves it unchanged.
      await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-keep") });
      const db2 = await pool.query<{ status: string }>(`SELECT status FROM pages WHERE id = $1`, [muldoonPageId]);
      expect(db2.rows[0].status).toBe("published");

      // Toggle back to draft.
      const draft = await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-draft"), status: "draft" });
      expect(draft.body.page.status).toBe("draft");
    } finally {
      await pool.query(`UPDATE pages SET status = $2 WHERE id = $1`, [muldoonPageId, original]);
    }
  });

  it("rejects an invalid status value (P5-T5.10)", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks(), status: "live" });
    expect(res.status).toBe(400);
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

  // ---------- BRAND TOKENS OVERRIDE (P3-T3.5) ----------

  it("accepts a brand_tokens_override and persists it", async () => {
    const override = { "--theme-main": "#ff00aa", "--theme-accent": "#000" };
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-bto"), brand_tokens_override: override });
    expect(res.status).toBe(200);

    const row = await pool.query<{ brand_tokens_override: Record<string, string> }>(
      `SELECT brand_tokens_override FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(row.rows[0].brand_tokens_override).toEqual(override);
  });

  it("rejects an invalid brand_tokens_override with 400", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({
        blocks: validBlocks("-bad"),
        brand_tokens_override: { "--brand-main": "#fff" }, // wrong prefix
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid payload/);
  });

  it("brand_tokens_override: null clears an existing override", async () => {
    // First, set one.
    await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-set"), brand_tokens_override: { "--theme-main": "#f00" } });
    // Then clear it explicitly.
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-clear"), brand_tokens_override: null });
    expect(res.status).toBe(200);

    const row = await pool.query<{ brand_tokens_override: unknown }>(
      `SELECT brand_tokens_override FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(row.rows[0].brand_tokens_override).toBeNull();
  });

  it("omitting brand_tokens_override leaves an existing override unchanged", async () => {
    const override = { "--theme-main": "#abcdef" };
    await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-pre"), brand_tokens_override: override });

    // Now save with NO brand_tokens_override in the payload.
    await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-noop") });

    const row = await pool.query<{ brand_tokens_override: Record<string, string> }>(
      `SELECT brand_tokens_override FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(row.rows[0].brand_tokens_override).toEqual(override);
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

  // Critical 1 (final review): the inline-editing engine's saves never send
  // `seo` at all (`src/admin/lib/inline-editor.ts` posts `{ blocks, source:
  // "inline" }`). Before the fix, the revision insert used `payload.seo ??
  // {}` directly, so an inline save wrote an SEO-EMPTY revision snapshot
  // even though the page's own seo column was left untouched by the
  // `COALESCE` — and restoring that revision (which applies seo
  // unconditionally, not COALESCE) then wiped the page's real seo to `{}`.
  it("an inline-style save (no seo in the payload) snapshots the page's CURRENT seo into the revision, so restoring it does not wipe seo", async () => {
    // 1st save — sets real seo.
    const withSeo = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-seo"), seo: { title: "Real SEO title" } });
    expect(withSeo.status).toBe(200);

    // 2nd save — inline-editor shape: blocks + source only, NO seo key.
    const inlineSave = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-inline"), source: "inline" });
    expect(inlineSave.status).toBe(200);
    // The response's resolved seo must reflect the still-unchanged page
    // seo, not an empty object.
    expect(inlineSave.body.page.seo).toMatchObject({ title: "Real SEO title" });
    const inlineRevisionId = inlineSave.body.revision.id;

    // The revision this inline save just created must carry the CURRENT
    // seo, not '{}'.
    const inlineRevRow = await pool.query<{ seo: Record<string, unknown> }>(
      `SELECT seo FROM page_revisions WHERE id = $1`,
      [inlineRevisionId],
    );
    expect(inlineRevRow.rows[0].seo).toMatchObject({ title: "Real SEO title" });

    // A later save that changes seo, so restoring the inline revision is a
    // genuine rollback, not a no-op.
    const later = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-later"), seo: { title: "Overwritten title" } });
    expect(later.status).toBe(200);

    // Restore the inline (seo-omitted) revision.
    const restored = await request(app)
      .post(
        `/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/revisions/${inlineRevisionId}/restore`,
      )
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(restored.status).toBe(200);

    const page = await pool.query<{ seo: Record<string, unknown> }>(
      `SELECT seo FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    // Must be the original real seo, NOT '{}'.
    expect(page.rows[0].seo).toMatchObject({ title: "Real SEO title" });
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

// ---------------------------------------------------------------------------
// POST /api/sites/:siteId/publish (Task B3 — one-click publish from the
// workspace top bar). Publishes every non-published page on the site in one
// call: same save+revision pattern as the single-page route (source:
// 'manual'), blocks/seo left untouched, status flipped to 'published'.
// ---------------------------------------------------------------------------
d("admin pages — bulk publish (Task B3)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;
  let homePageId: string;
  let draftAId: string;
  let draftBId: string;

  function buildAppWithEnqueueSpy(
    spy: (input: { siteId: string; trigger: string }) => Promise<string | null>,
  ): express.Express {
    const a = express();
    a.use(express.json({ limit: "1mb" }));
    a.use(
      "/api",
      adminPagesRouter({
        pool,
        saveRateLimit: { max: 100, windowMs: 60_000 },
        enqueueGitExport: spy,
      }),
    );
    return a;
  }

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
    homePageId = r.rows[0].page_id;

    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM pages WHERE id = ANY($1::uuid[])`, [
      [draftAId, draftBId].filter(Boolean),
    ]).catch(() => undefined);
    await pool.query(`UPDATE pages SET status = 'published' WHERE id = $1`, [homePageId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  beforeEach(async () => {
    // Fresh pair of drafts per test (previous test's drafts, if any, are
    // torn down at the end of that test) so each test starts from a known
    // "two drafts + one already-published home" baseline.
    await pool.query(`UPDATE pages SET status = 'published' WHERE id = $1`, [homePageId]);
    const a = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'draft-a', 'Draft A', '[]'::jsonb, '{"title":"Draft A SEO"}'::jsonb, 'draft')
       RETURNING id`,
      [siteId],
    );
    draftAId = a.rows[0].id;
    const b = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'draft-b', 'Draft B', '[]'::jsonb, '{"title":"Draft B SEO"}'::jsonb, 'draft')
       RETURNING id`,
      [siteId],
    );
    draftBId = b.rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM page_revisions WHERE page_id = ANY($1::uuid[])`, [
      [draftAId, draftBId, homePageId],
    ]);
    await pool.query(`DELETE FROM pages WHERE id = ANY($1::uuid[])`, [[draftAId, draftBId]]);
  });

  it("publishes every draft page, appends a 'manual' revision per page, and returns the live_url", async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/publish`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ published: 2 });
    expect(res.body.live_url).toMatch(/^https:\/\//);

    const statuses = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM pages WHERE id = ANY($1::uuid[])`,
      [[draftAId, draftBId]],
    );
    for (const row of statuses.rows) expect(row.status).toBe("published");

    const revs = await pool.query<{ page_id: string; source: string }>(
      `SELECT page_id, source FROM page_revisions WHERE page_id = ANY($1::uuid[])`,
      [[draftAId, draftBId]],
    );
    expect(revs.rows).toHaveLength(2);
    for (const row of revs.rows) expect(row.source).toBe("manual");
  });

  it("preserves each page's blocks/seo untouched — only status flips", async () => {
    await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);

    const row = await pool.query<{ blocks: unknown[]; seo: Record<string, unknown> }>(
      `SELECT blocks, seo FROM pages WHERE id = $1`,
      [draftAId],
    );
    expect(row.rows[0].blocks).toEqual([]);
    expect(row.rows[0].seo).toMatchObject({ title: "Draft A SEO" });

    const rev = await pool.query<{ seo: Record<string, unknown> }>(
      `SELECT seo FROM page_revisions WHERE page_id = $1`,
      [draftAId],
    );
    expect(rev.rows[0].seo).toMatchObject({ title: "Draft A SEO" });
  });

  it("is idempotent: a second call publishes nothing further", async () => {
    const first = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(first.body.published).toBe(2);

    const second = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ published: 0 });
  });

  it("404s for an unknown site", async () => {
    const res = await request(app)
      .post(`/api/sites/00000000-0000-0000-0000-000000000000/publish`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "site not found" });
  });

  it("rejects 401 without a token", async () => {
    const res = await request(app).post(`/api/sites/${siteId}/publish`);
    expect(res.status).toBe(401);
  });

  it("enqueues git.export once for the whole batch when pages were published and git sync is enabled", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, true, now())
       ON CONFLICT (site_id) DO UPDATE SET enabled = true, updated_at = now()`,
      [siteId],
    );
    const spy = vi.fn(async () => "job-1");
    const spyApp = buildAppWithEnqueueSpy(spy);
    process.env.GITHUB_CONTENT_TOKEN = "tok123";
    process.env.GITHUB_CONTENT_REPO = "acme/content";

    try {
      const res = await request(spyApp).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.published).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ siteId, trigger: "publish" });
    } finally {
      delete process.env.GITHUB_CONTENT_TOKEN;
      delete process.env.GITHUB_CONTENT_REPO;
      await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]);
    }
  });

  it("does not enqueue git.export when nothing was published (idempotent no-op call)", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, true, now())
       ON CONFLICT (site_id) DO UPDATE SET enabled = true, updated_at = now()`,
      [siteId],
    );
    const spy = vi.fn(async () => "job-1");
    const spyApp = buildAppWithEnqueueSpy(spy);
    process.env.GITHUB_CONTENT_TOKEN = "tok123";
    process.env.GITHUB_CONTENT_REPO = "acme/content";

    try {
      // First call publishes both drafts; second call is the no-op.
      await request(spyApp).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      spy.mockClear();
      const res = await request(spyApp).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      expect(res.body).toMatchObject({ published: 0 });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      delete process.env.GITHUB_CONTENT_TOKEN;
      delete process.env.GITHUB_CONTENT_REPO;
      await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]);
    }
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

// ---------------------------------------------------------------------------
// git.export publish trigger (T4, GitHub sync)
// ---------------------------------------------------------------------------
d("admin pages — git.export publish trigger (T4)", () => {
  let pool: Pool;
  let siteId: string;
  let pageId: string;
  const originalToken = process.env.GITHUB_CONTENT_TOKEN;
  const originalRepo = process.env.GITHUB_CONTENT_REPO;

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

    // Enabled ("api") mode — the route's resolveGitMode() check reads real
    // env, so these tests need it non-disabled to reach the getGitState gate.
    process.env.GITHUB_CONTENT_TOKEN = "tok123";
    process.env.GITHUB_CONTENT_REPO = "acme/content";
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]).catch(() => undefined);
    await pool.query(`UPDATE pages SET status = 'draft' WHERE id = $1`, [pageId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    if (originalToken === undefined) delete process.env.GITHUB_CONTENT_TOKEN;
    else process.env.GITHUB_CONTENT_TOKEN = originalToken;
    if (originalRepo === undefined) delete process.env.GITHUB_CONTENT_REPO;
    else process.env.GITHUB_CONTENT_REPO = originalRepo;
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM page_revisions WHERE page_id = $1`, [pageId]);
    await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]);
    await pool.query(`UPDATE pages SET status = 'draft', brand_tokens_override = NULL WHERE id = $1`, [pageId]);
  });

  function buildAppWithEnqueueSpy(
    spy: (input: { siteId: string; trigger: string }) => Promise<string | null>,
  ): express.Express {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api",
      adminPagesRouter({
        pool,
        saveRateLimit: { max: 100, windowMs: 60_000 },
        enqueueGitExport: spy,
      }),
    );
    return app;
  }

  it("enqueues git.export once with {siteId, trigger:'publish'} when a publish save's site has git sync enabled", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, true, now())`,
      [siteId],
    );
    const spy = vi.fn(async () => "job-1");
    const app = buildAppWithEnqueueSpy(spy);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-pub-trigger"), status: "published" });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ siteId, trigger: "publish" });
  });

  it("does not enqueue when the save leaves the page as draft", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, true, now())`,
      [siteId],
    );
    const spy = vi.fn(async () => "job-1");
    const app = buildAppWithEnqueueSpy(spy);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-draft-trigger") });

    expect(res.status).toBe(200);
    expect(res.body.page.status).toBe("draft");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not enqueue when the site has no git state row, even on a publish save", async () => {
    // beforeEach already ensures no site_git_state row exists.
    const spy = vi.fn(async () => "job-1");
    const app = buildAppWithEnqueueSpy(spy);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-nostate-trigger"), status: "published" });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not enqueue when the site's git state row is disabled, even on a publish save", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, false, now())`,
      [siteId],
    );
    const spy = vi.fn(async () => "job-1");
    const app = buildAppWithEnqueueSpy(spy);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-stateoff-trigger"), status: "published" });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
