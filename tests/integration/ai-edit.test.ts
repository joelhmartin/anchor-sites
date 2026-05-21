import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function buildApp(
  pool: Pool,
  aiEditRateLimit?: { max: number; windowMs: number },
): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    adminPagesRouter({ pool, saveRateLimit: { max: 100, windowMs: 60_000 }, aiEditRateLimit }),
  );
  return app;
}

d("AI-edit endpoint (integration, dry-run)", () => {
  let pool: Pool;
  let app: express.Express;
  let siteId: string;
  let pageId: string;
  // A dedicated throwaway page for the apply test, so persisting AI edits never
  // pollutes the seeded muldoon home that page-render.test.ts asserts on.
  let applyPageId: string;
  const prevKey = process.env.ANTHROPIC_API_KEY;

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
    await seed(pool);
    const r = await pool.query<{ id: string; page_id: string }>(
      `SELECT s.id, p.id AS page_id FROM sites s JOIN pages p ON p.site_id = s.id
        WHERE s.slug = 'muldoon-dental' AND p.slug = 'home'`,
    );
    siteId = r.rows[0].id;
    pageId = r.rows[0].page_id;

    const ap = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, status)
       VALUES ($1, 'ai-apply-test', 'AI apply test', '[]'::jsonb, 'draft')
       RETURNING id`,
      [siteId],
    );
    applyPageId = ap.rows[0].id;

    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    // Force the AI service into deterministic dry-run (no spend, no network).
    process.env.ANTHROPIC_API_KEY = "dry-run";
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    // Drop the throwaway page (CASCADE removes its revisions) — zero footprint.
    await pool.query(`DELETE FROM pages WHERE id = $1`, [applyPageId]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    delete process.env.ADMIN_API_TOKEN;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  });

  it("401 without an admin token", async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}/ai-edit`)
      .send({ instruction: "make the hero punchier" });
    expect(res.status).toBe(401);
  });

  it("400 on an empty instruction", async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}/ai-edit`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ instruction: "   " });
    expect(res.status).toBe(400);
  });

  it("404 when the page does not belong to the site", async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/00000000-0000-0000-0000-000000000000/ai-edit`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ instruction: "add a CTA" });
    expect(res.status).toBe(404);
  });

  it("200 returns a validated proposal + diff and does NOT persist", async () => {
    const before = await pool.query<{ blocks: unknown }>(`SELECT blocks FROM pages WHERE id = $1`, [pageId]);
    const beforeBlocks = JSON.stringify(before.rows[0].blocks);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pages/${pageId}/ai-edit`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ instruction: "add a closing section", target_id: "some-block" });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("dry-run");
    expect(Array.isArray(res.body.proposed_blocks)).toBe(true);
    // Dry-run appends one rich-text block.
    expect(res.body.diff.added).toHaveLength(1);
    expect(res.body.proposed_blocks.at(-1).type).toBe("rich-text");

    // Critical: the preview did not touch the stored page.
    const after = await pool.query<{ blocks: unknown }>(`SELECT blocks FROM pages WHERE id = $1`, [pageId]);
    expect(JSON.stringify(after.rows[0].blocks)).toBe(beforeBlocks);
  });

  it("applies an accepted proposal through the existing save endpoint with source:'ai' (P6-T6.5)", async () => {
    // 1. Preview a change for the throwaway page.
    const preview = await request(app)
      .post(`/api/sites/${siteId}/pages/${applyPageId}/ai-edit`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ instruction: "add a closing section" });
    expect(preview.status).toBe(200);
    const proposed = preview.body.proposed_blocks;
    expect(proposed.length).toBeGreaterThan(0);

    // 2. Operator accepts → save through the EXISTING page-save endpoint, tagged source:'ai'.
    const apply = await request(app)
      .post(`/api/sites/${siteId}/pages/${applyPageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: proposed, source: "ai" });
    expect(apply.status).toBe(200);

    // 3. The page now holds the proposed blocks.
    const page = await pool.query<{ blocks: { type: string }[] }>(
      `SELECT blocks FROM pages WHERE id = $1`,
      [applyPageId],
    );
    expect(page.rows[0].blocks.at(-1)!.type).toBe("rich-text");

    // 4. A page_revisions row recorded source='ai'.
    const rev = await pool.query<{ source: string }>(
      `SELECT source FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [applyPageId],
    );
    expect(rev.rows[0].source).toBe("ai");

    // 5. The revisions panel surfaces the AI revision (demo milestone).
    const list = await request(app)
      .get(`/api/sites/${siteId}/pages/${applyPageId}/revisions`)
      .set("X-Admin-Token", ADMIN_TOKEN);
    expect(list.status).toBe(200);
    expect(list.body.revisions[0].source).toBe("ai");
  });

  it("rate-limits AI calls — 429 once the budget is spent (P6-T6.7)", async () => {
    const limited = buildApp(pool, { max: 2, windowMs: 60_000 });
    const call = () =>
      request(limited)
        .post(`/api/sites/${siteId}/pages/${pageId}/ai-edit`)
        .set("X-Admin-Token", ADMIN_TOKEN)
        .send({ instruction: "x" });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });
});
