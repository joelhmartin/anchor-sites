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

  // ---------- STATUS (D436 — per-page publish/unpublish) ----------

  it("PATCH .../status publishes then unpublishes a single page (D436)", async () => {
    // Start from a known draft state.
    await pool.query(`UPDATE pages SET status = 'draft', published_at = NULL, published_snapshot = NULL WHERE id = $1`, [muldoonPageId]);

    const pub = await request(app)
      .patch(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ status: "published" });
    expect(pub.status).toBe(200);
    expect(pub.body.page.status).toBe("published");
    const afterPub = await pool.query(
      `SELECT status, published_at, published_snapshot FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(afterPub.rows[0].status).toBe("published");
    expect(afterPub.rows[0].published_at).not.toBeNull();
    expect(afterPub.rows[0].published_snapshot).not.toBeNull();

    const unpub = await request(app)
      .patch(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ status: "draft" });
    expect(unpub.status).toBe(200);
    const afterUnpub = await pool.query(`SELECT status, published_at FROM pages WHERE id = $1`, [muldoonPageId]);
    expect(afterUnpub.rows[0].status).toBe("draft");
    expect(afterUnpub.rows[0].published_at).toBeNull();
  });

  it("PATCH .../status 400s an invalid status and 404s an unknown page (D436)", async () => {
    const bad = await request(app)
      .patch(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}/status`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ status: "archived" });
    expect(bad.status).toBe(400);
    const missing = await request(app)
      .patch(`/api/sites/${muldoonSiteId}/pages/00000000-0000-0000-0000-000000000000/status`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ status: "published" });
    expect(missing.status).toBe(404);
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

  // ---------- D301/D504 — snapshot-on-publish (single-page save) ----------

  it("D301/D504: save with status:'published' freezes published_snapshot from the SAVED payload and stamps published_at", async () => {
    const before = await pool.query<{ status: string; snapshot: unknown; published_at: string | null }>(
      `SELECT status, published_snapshot AS snapshot, published_at FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    try {
      const res = await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-snap"), seo: { title: "Snap SEO" }, status: "published" });
      expect(res.status).toBe(200);

      const row = await pool.query<{
        title: string;
        snapshot: { title: string; blocks: unknown[]; seo: Record<string, unknown> };
        published_at: string | null;
      }>(
        `SELECT title, published_snapshot AS snapshot, published_at FROM pages WHERE id = $1`,
        [muldoonPageId],
      );
      expect(row.rows[0].published_at).not.toBeNull();
      expect(row.rows[0].snapshot.blocks).toEqual(validBlocks("-snap"));
      expect(row.rows[0].snapshot.seo).toEqual({ title: "Snap SEO" });
      // This route never writes title — the snapshot carries the row's own.
      expect(row.rows[0].snapshot.title).toBe(row.rows[0].title);
    } finally {
      await pool.query(
        `UPDATE pages SET status = $2, published_snapshot = $3::jsonb, published_at = $4 WHERE id = $1`,
        [muldoonPageId, before.rows[0].status, JSON.stringify(before.rows[0].snapshot), before.rows[0].published_at],
      );
    }
  });

  it("D301: a plain save (no status) on an already-published page leaves the snapshot untouched — the edit stays off live", async () => {
    const before = await pool.query<{ snapshot: unknown }>(
      `SELECT published_snapshot AS snapshot FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(before.rows[0].snapshot).not.toBeNull(); // seeded published page has one

    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-inline-edit") });
    expect(res.status).toBe(200);

    const after = await pool.query<{ snapshot: { blocks: unknown[] }; blocks: unknown[] }>(
      `SELECT published_snapshot AS snapshot, blocks FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    expect(after.rows[0].blocks).toEqual(validBlocks("-inline-edit"));
    expect(after.rows[0].snapshot).toEqual(before.rows[0].snapshot);
  });

  it("D301/D504: save with status:'draft' clears published_at and keeps the snapshot", async () => {
    const before = await pool.query<{ status: string; snapshot: unknown; published_at: string | null }>(
      `SELECT status, published_snapshot AS snapshot, published_at FROM pages WHERE id = $1`,
      [muldoonPageId],
    );
    try {
      const res = await request(app)
        .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ blocks: validBlocks("-unpub"), status: "draft" });
      expect(res.status).toBe(200);

      const row = await pool.query<{ snapshot: unknown; published_at: string | null }>(
        `SELECT published_snapshot AS snapshot, published_at FROM pages WHERE id = $1`,
        [muldoonPageId],
      );
      expect(row.rows[0].published_at).toBeNull();
      expect(row.rows[0].snapshot).toEqual(before.rows[0].snapshot);
    } finally {
      await pool.query(
        `UPDATE pages SET status = $2, published_snapshot = $3::jsonb, published_at = $4 WHERE id = $1`,
        [muldoonPageId, before.rows[0].status, JSON.stringify(before.rows[0].snapshot), before.rows[0].published_at],
      );
    }
  });

  // ---------- SAVE ----------

  // ── W2-CONC / D308: optimistic concurrency on whole-array saves ──

  it("D308: a save carrying the page's current updated_at succeeds and returns the NEW updated_at to rebase on", async () => {
    const before = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    const base = new Date(before.body.page.updated_at).toISOString();

    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-d308-ok"), source: "inline", base_updated_at: base });
    expect(res.status).toBe(200);
    expect(res.body.page.updated_at).toBeTruthy();
    // The returned marker is the row's NEW updated_at — a follow-up save
    // using it must succeed too (the rebase loop the inline editor runs).
    const res2 = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({
        blocks: validBlocks("-d308-ok2"),
        source: "inline",
        base_updated_at: new Date(res.body.page.updated_at).toISOString(),
      });
    expect(res2.status).toBe(200);
  });

  it("D308: a save whose base marker the page has moved past 409s and leaves the page untouched", async () => {
    const before = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    const staleBase = new Date(before.body.page.updated_at).toISOString();

    // Someone else's save lands after our snapshot (an agent turn, a second tab).
    const interloper = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-d308-interloper"), source: "agent" });
    expect(interloper.status).toBe(200);

    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-d308-clobber"), source: "inline", base_updated_at: staleBase });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed underneath/i);

    // The interloper's content survived — nothing was clobbered.
    const after = await request(app)
      .get(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(after.body.page.blocks[0].id).toBe("h1-d308-interloper");
  });

  it("D308: omitting base_updated_at keeps the legacy last-write-wins behavior; a missing page still 404s over 409", async () => {
    const res = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/${muldoonPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: validBlocks("-d308-legacy") });
    expect(res.status).toBe(200);

    const missing = await request(app)
      .post(`/api/sites/${muldoonSiteId}/pages/00000000-0000-0000-0000-000000000000`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({
        blocks: validBlocks("-d308-404"),
        base_updated_at: new Date().toISOString(),
      });
    expect(missing.status).toBe(404);
  });

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
    // Item 2b's tests drive the primary domain's provisioning columns; put
    // them back to what db/seed.ts writes so nothing downstream inherits a
    // half-provisioned domain.
    await pool.query(
      `UPDATE site_domains SET verification_status = 'verified', ssl_status = 'active'
        WHERE site_id = $1 AND is_primary = true`,
      [siteId],
    );
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

  // ---------- D301/D504 — snapshot-on-publish (bulk publish) ----------

  it("D301/D504: publish freezes each page's published_snapshot and stamps published_at", async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/publish`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(2);

    const rows = await pool.query<{
      id: string;
      snapshot: { title: string; blocks: unknown[]; seo: Record<string, unknown> } | null;
      published_at: string | null;
    }>(
      `SELECT id, published_snapshot AS snapshot, published_at
         FROM pages WHERE id = ANY($1::uuid[])`,
      [[draftAId, draftBId]],
    );
    for (const row of rows.rows) {
      expect(row.published_at).not.toBeNull();
      expect(row.snapshot).not.toBeNull();
      expect(row.snapshot!.blocks).toEqual([]);
    }
    const draftA = rows.rows.find((r) => r.id === draftAId)!;
    expect(draftA.snapshot!.title).toBe("Draft A");
    expect(draftA.snapshot!.seo).toEqual({ title: "Draft A SEO" });
  });

  it("D301: a post-publish edit counts as publishable again, and re-publishing re-freezes the snapshot", async () => {
    // First publish: both drafts go live.
    const first = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(first.body.published).toBe(2);

    // Simulate the agent / inline editor: edit working blocks WITHOUT
    // touching status (the exact D301 leak path).
    const editedBlocks = [{ id: "r-edit", type: "rich-text", props: { html: "<p>edited</p>", max_width: "medium" } }];
    await pool.query(`UPDATE pages SET blocks = $2::jsonb WHERE id = $1`, [
      draftAId,
      JSON.stringify(editedBlocks),
    ]);

    // The edit must NOT have reached the snapshot…
    const mid = await pool.query<{ snapshot: { blocks: unknown[] } }>(
      `SELECT published_snapshot AS snapshot FROM pages WHERE id = $1`,
      [draftAId],
    );
    expect(mid.rows[0].snapshot.blocks).toEqual([]);

    // …and a second publish picks up EXACTLY that one dirty page.
    const second = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(second.status).toBe(200);
    expect(second.body.published).toBe(1);

    const after = await pool.query<{ snapshot: { blocks: unknown[] }; published_at: string | null }>(
      `SELECT published_snapshot AS snapshot, published_at FROM pages WHERE id = $1`,
      [draftAId],
    );
    expect(after.rows[0].snapshot.blocks).toEqual(editedBlocks);
    expect(after.rows[0].published_at).not.toBeNull();
  });

  // FINAL whole-branch review, FIX-NOW item 2b — the publish response's
  // live_url used to carry no provisioning state at all, so the workspace
  // rendered a success-styled link to a hostname whose Cloud Run mapping /
  // cert might not exist yet: a dead link presented as a finished site.
  it("reports live_url_ready:false (with the raw statuses) while the primary domain is still provisioning", async () => {
    await pool.query(
      `UPDATE site_domains SET verification_status = 'pending', ssl_status = 'pending'
        WHERE site_id = $1 AND is_primary = true`,
      [siteId],
    );

    const res = await request(app)
      .post(`/api/sites/${siteId}/publish`)
      .set("X-Admin-Token", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.live_url).toMatch(/^https:\/\//);
    expect(res.body.live_url_ready).toBe(false);
    expect(res.body.live_url_status).toEqual({
      verification_status: "pending",
      ssl_status: "pending",
    });
  });

  it("reports live_url_ready:true once the primary domain is verified with an active cert", async () => {
    await pool.query(
      `UPDATE site_domains SET verification_status = 'verified', ssl_status = 'active'
        WHERE site_id = $1 AND is_primary = true`,
      [siteId],
    );

    const res = await request(app)
      .post(`/api/sites/${siteId}/publish`)
      .set("X-Admin-Token", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.live_url_ready).toBe(true);
    expect(res.body.live_url_status).toEqual({
      verification_status: "verified",
      ssl_status: "active",
    });
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

  // D611: the old behavior — `enqueueGitExport(...).catch(() => undefined)`
  // gated on `published > 0` — was a one-shot with no second chance: a
  // failed enqueue was invisible in the response, and because a second
  // publish publishes 0 pages the trigger never re-fired. Now every publish
  // on a sync-enabled site fires the export (the export job itself no-ops
  // via blob-sha comparison when the repo already matches), and the enqueue
  // outcome is reported honestly in the response.
  it("D611: a no-op publish on a sync-enabled site STILL enqueues git.export (the retry path for a previously failed enqueue)", async () => {
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
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.body.git_export).toEqual({ queued: true });
    } finally {
      delete process.env.GITHUB_CONTENT_TOKEN;
      delete process.env.GITHUB_CONTENT_REPO;
      await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]);
    }
  });

  it("D611: a failed export enqueue is reported in the publish response (publish itself still succeeds)", async () => {
    await pool.query(
      `INSERT INTO site_git_state (site_id, enabled, updated_at) VALUES ($1, true, now())
       ON CONFLICT (site_id) DO UPDATE SET enabled = true, updated_at = now()`,
      [siteId],
    );
    const spy = vi.fn(async () => {
      throw new Error("boss not started");
    });
    const spyApp = buildAppWithEnqueueSpy(spy);
    process.env.GITHUB_CONTENT_TOKEN = "tok123";
    process.env.GITHUB_CONTENT_REPO = "acme/content";

    try {
      const res = await request(spyApp).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      expect(res.status).toBe(200); // pages ARE published — export is best-effort…
      expect(res.body.published).toBe(2);
      // …but no longer silently: the failure is visible to the caller.
      expect(res.body.git_export).toEqual({ queued: false, error: "boss not started" });
    } finally {
      delete process.env.GITHUB_CONTENT_TOKEN;
      delete process.env.GITHUB_CONTENT_REPO;
      await pool.query(`DELETE FROM site_git_state WHERE site_id = $1`, [siteId]);
    }
  });

  it("D611: git_export is null when sync is not enabled for the site", async () => {
    const res = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.git_export).toBeNull();
  });

  // D610: the publish-during-build guard was client-side only (a disabled
  // button) — the server happily flipped every draft mid-turn, immortalizing
  // half-written pages as live content + a 'manual' revision.
  it("D610: publish 409s while the site has a running agent conversation", async () => {
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO ai_conversations (site_id, status) VALUES ($1, 'running') RETURNING id`,
      [siteId],
    );
    try {
      const res = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/agent is running/i);
      // Nothing was published.
      const still = await pool.query<{ status: string }>(
        `SELECT status FROM pages WHERE id = ANY($1::uuid[])`,
        [[draftAId, draftBId]],
      );
      for (const row of still.rows) expect(row.status).toBe("draft");
    } finally {
      await pool.query(`DELETE FROM ai_conversations WHERE id = $1`, [conv.rows[0].id]);
    }
  });

  it("D610: publish proceeds when the site's conversations are all settled (active/error/archived)", async () => {
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO ai_conversations (site_id, status) VALUES ($1, 'active') RETURNING id`,
      [siteId],
    );
    try {
      const res = await request(app).post(`/api/sites/${siteId}/publish`).set("X-Admin-Token", ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.published).toBe(2);
    } finally {
      await pool.query(`DELETE FROM ai_conversations WHERE id = $1`, [conv.rows[0].id]);
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

// ---------------------------------------------------------------------------
// DELETE /api/sites/:siteId/pages/:pageId (D105/D405/D505) — the operator's
// page terminal state, reusing W2-SEC's deleted_pages tombstone pattern.
// ---------------------------------------------------------------------------
d("admin pages — DELETE page (D105/D405/D505)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ($1, 'Del Test') RETURNING id`,
      [`deltest-${Date.now()}`],
    );
    siteId = r.rows[0].id;
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE id = $1`, [siteId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  async function addPage(slug: string, status = "draft") {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, $2, $2, '[]'::jsonb, '{}'::jsonb, $3) RETURNING id`,
      [siteId, slug, status],
    );
    return r.rows[0].id;
  }

  it("401 without token", async () => {
    const r = await request(app).delete(`/api/sites/${siteId}/pages/00000000-0000-0000-0000-000000000000`);
    expect(r.status).toBe(401);
  });

  it("404 for a page not on this site", async () => {
    await addPage(`keep-${Date.now()}`);
    const r = await request(app)
      .delete(`/api/sites/${siteId}/pages/00000000-0000-0000-0000-000000000000`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(404);
  });

  it("refuses to delete the site's only remaining page (409)", async () => {
    // Fresh single-page site.
    const s = await pool.query<{ id: string }>(
      `INSERT INTO sites (slug, display_name) VALUES ($1, 'Solo') RETURNING id`,
      [`solo-${Date.now()}`],
    );
    const only = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'home', 'Home', '[]'::jsonb, '{}'::jsonb, 'draft') RETURNING id`,
      [s.rows[0].id],
    );
    const r = await request(app)
      .delete(`/api/sites/${s.rows[0].id}/pages/${only.rows[0].id}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(409);
    await pool.query(`DELETE FROM sites WHERE id = $1`, [s.rows[0].id]).catch(() => undefined);
  });

  it("deletes a page and writes a recoverable tombstone (deleted_by='manual')", async () => {
    await addPage(`anchor-${Date.now()}`); // keep the site multi-page
    const victim = await addPage(`victim-${Date.now()}`, "published");
    const r = await request(app)
      .delete(`/api/sites/${siteId}/pages/${victim}`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.deleted.page_id).toBe(victim);

    const gone = await pool.query(`SELECT 1 FROM pages WHERE id = $1`, [victim]);
    expect(gone.rowCount).toBe(0);

    const tomb = await pool.query<{ deleted_by: string; status: string }>(
      `SELECT deleted_by, status FROM deleted_pages WHERE page_id = $1`,
      [victim],
    );
    expect(tomb.rowCount).toBe(1);
    expect(tomb.rows[0].deleted_by).toBe("manual");
    expect(tomb.rows[0].status).toBe("published");
  });
});
