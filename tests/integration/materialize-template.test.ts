import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { createTemplate } from "../../src/server/templates/repo.js";
import { handleMaterializeTemplate } from "../../src/server/jobs/materialize-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const runMigrate = (direction: "up" | "down", count: number) =>
  migrate({
    databaseUrl: TEST_DB_URL!,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => undefined,
  });

const blocks = (s: string) => [
  { id: "h" + s, type: "hero", props: { title: "Hero " + s, align: "center" } },
];

async function newSite(pool: Pool, slug: string, brandTokens: Record<string, string> = {}): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO sites (slug, display_name, default_brand_tokens)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [slug, slug, JSON.stringify(brandTokens)],
  );
  return res.rows[0].id;
}

d("materialize-template job (integration, P7-T7.5)", () => {
  let pool: Pool;
  let templateId: string;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });

    const { template } = await createTemplate(
      {
        slug: "mattpl-base",
        name: "Materialize Base",
        kind: "site",
        brand_tokens: { "--theme-main": "#123456", "--theme-accent": "#abcdef" },
        pages: [
          { slug: "home", title: "Home", blocks: blocks("home"), seo: { title: "H" } },
          { slug: "about", title: "About", blocks: blocks("about"), seo: {} },
        ],
      },
      { pool },
    );
    templateId = template.id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM sites WHERE slug LIKE 'mat-%'`).catch(() => undefined);
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'mattpl-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("materializes pages + adopts brand tokens into an empty site, with import revisions", async () => {
    const siteId = await newSite(pool, "mat-empty");
    const result = await handleMaterializeTemplate({ siteId, templateId }, { pool });

    expect(result).toMatchObject({
      pages_created: 2,
      pages_skipped: 0,
      brand_tokens_adopted: true,
    });

    const pages = await pool.query<{
      slug: string;
      status: string;
      snapshot: { title: string; blocks: unknown[] } | null;
      published_at: string | null;
      sort_order: number | null;
    }>(
      `SELECT slug, status, published_snapshot AS snapshot, published_at, sort_order
         FROM pages WHERE site_id = $1 ORDER BY slug`,
      [siteId],
    );
    expect(pages.rows.map((p) => p.slug)).toEqual(["about", "home"]);

    // D702: the authored template page order survives materialization —
    // createTemplate assigned home=0, about=1.
    const bySlug = new Map(pages.rows.map((p) => [p.slug, p.sort_order]));
    expect(bySlug.get("home")).toBe(0);
    expect(bySlug.get("about")).toBe(1);

    // D716: create-from-template must yield a BROWSABLE live URL — the
    // provision job has already been enqueued for a public hostname, so
    // pages materialize as published, with the D301 snapshot + published_at
    // the tenant route needs. (Post-create agent/compose edits then stay
    // draft until the operator publishes, thanks to D301.)
    for (const p of pages.rows) {
      expect(p.status).toBe("published");
      expect(p.published_at).not.toBeNull();
      expect(p.snapshot).not.toBeNull();
      expect(Array.isArray(p.snapshot!.blocks)).toBe(true);
      expect(p.snapshot!.title).toBeTruthy();
    }

    // Each created page has exactly one 'import' revision.
    const revs = await pool.query<{ source: string; count: string }>(
      `SELECT pr.source, count(*)::text AS count
         FROM page_revisions pr JOIN pages p ON p.id = pr.page_id
        WHERE p.site_id = $1 GROUP BY pr.source`,
      [siteId],
    );
    expect(revs.rows).toEqual([{ source: "import", count: "2" }]);

    const site = await pool.query<{ default_brand_tokens: Record<string, string> }>(
      `SELECT default_brand_tokens FROM sites WHERE id = $1`,
      [siteId],
    );
    expect(site.rows[0].default_brand_tokens).toEqual({
      "--theme-main": "#123456",
      "--theme-accent": "#abcdef",
    });
  });

  it("is idempotent — a second run creates nothing and leaves brand tokens intact", async () => {
    const siteId = await newSite(pool, "mat-idem");
    await handleMaterializeTemplate({ siteId, templateId }, { pool });
    const second = await handleMaterializeTemplate({ siteId, templateId }, { pool });

    expect(second).toMatchObject({
      pages_created: 0,
      pages_skipped: 2,
      brand_tokens_adopted: false, // site already has tokens after run 1
    });

    const pageCount = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pages WHERE site_id = $1`,
      [siteId],
    );
    expect(Number(pageCount.rows[0].count)).toBe(2);
  });

  it("does NOT override brand tokens a site already has", async () => {
    const siteId = await newSite(pool, "mat-branded", { "--theme-main": "#000000" });
    const result = await handleMaterializeTemplate({ siteId, templateId }, { pool });

    expect(result.brand_tokens_adopted).toBe(false);
    const site = await pool.query<{ default_brand_tokens: Record<string, string> }>(
      `SELECT default_brand_tokens FROM sites WHERE id = $1`,
      [siteId],
    );
    expect(site.rows[0].default_brand_tokens).toEqual({ "--theme-main": "#000000" });
  });

  it("only fills pages the site doesn't already have (slug collision skipped)", async () => {
    const siteId = await newSite(pool, "mat-partial");
    // Pre-create a 'home' page so materialization should skip it.
    await pool.query(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'home', 'Existing Home', '[]'::jsonb, '{}'::jsonb, 'published')`,
      [siteId],
    );
    const result = await handleMaterializeTemplate({ siteId, templateId }, { pool });
    expect(result).toMatchObject({ pages_created: 1, pages_skipped: 1 });

    // The pre-existing home was not overwritten.
    const home = await pool.query<{ title: string; status: string }>(
      `SELECT title, status FROM pages WHERE site_id = $1 AND slug = 'home'`,
      [siteId],
    );
    expect(home.rows[0]).toEqual({ title: "Existing Home", status: "published" });
  });

  it("throws for an unknown site or template", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    const siteId = await newSite(pool, "mat-throw");
    await expect(handleMaterializeTemplate({ siteId: ghost, templateId }, { pool })).rejects.toThrow(/site not found/);
    await expect(handleMaterializeTemplate({ siteId, templateId: ghost }, { pool })).rejects.toThrow(/template not found/);
  });
});
