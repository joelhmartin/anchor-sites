import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import {
  createTemplate,
  listTemplates,
  getTemplate,
  archiveTemplate,
  TemplateValidationError,
  TemplateSlugConflictError,
} from "../../src/server/templates/repo.js";

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

const validBlocks = (suffix = "") => [
  { id: "h" + suffix, type: "hero", props: { title: "Hero " + suffix, align: "center" } },
  { id: "r" + suffix, type: "rich-text", props: { html: "<p>Body " + suffix + "</p>", max_width: "medium" } },
];

d("templates repository (integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
  }, 60_000);

  afterAll(async () => {
    // Clean up only what this file created (slug-prefixed); CASCADE drops pages.
    await pool.query(`DELETE FROM templates WHERE slug LIKE 'tpltest-%'`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("creates a site template with ordered pages and a brand token", async () => {
    const { template, pages } = await createTemplate(
      {
        slug: "tpltest-site-a",
        name: "Site A",
        description: "first",
        kind: "site",
        brand_tokens: { "--theme-main": "#0a3d62" },
        pages: [
          { slug: "home", title: "Home", blocks: validBlocks("home"), seo: { title: "H" } },
          { slug: "about", title: "About", blocks: validBlocks("about"), seo: {} },
        ],
      },
      { pool },
    );

    expect(template.slug).toBe("tpltest-site-a");
    expect(template.kind).toBe("site");
    expect(template.status).toBe("active");
    expect(template.brand_tokens).toEqual({ "--theme-main": "#0a3d62" });
    expect(pages).toHaveLength(2);
    // sort_order assigned from array position.
    expect(pages[0]).toMatchObject({ slug: "home", sort_order: 0 });
    expect(pages[1]).toMatchObject({ slug: "about", sort_order: 1 });
    expect(pages[0].blocks).toHaveLength(2);
  });

  it("getTemplate returns the template + pages ordered by sort_order", async () => {
    const created = await createTemplate(
      {
        slug: "tpltest-ordered",
        name: "Ordered",
        pages: [
          { slug: "a", title: "A", blocks: [] },
          { slug: "b", title: "B", blocks: [] },
          { slug: "c", title: "C", blocks: [] },
        ],
      },
      { pool },
    );
    const fetched = await getTemplate(created.template.id, { pool });
    expect(fetched).not.toBeNull();
    expect(fetched!.pages.map((p) => p.slug)).toEqual(["a", "b", "c"]);
    expect(fetched!.pages.map((p) => p.sort_order)).toEqual([0, 1, 2]);
  });

  it("getTemplate returns null for an unknown id", async () => {
    const fetched = await getTemplate("00000000-0000-0000-0000-000000000000", { pool });
    expect(fetched).toBeNull();
  });

  it("listTemplates filters by kind + status and includes pages_count", async () => {
    await createTemplate(
      { slug: "tpltest-page-x", name: "Page X", kind: "page", pages: [{ slug: "snippet", title: "Snippet", blocks: [] }] },
      { pool },
    );
    const sites = await listTemplates({ pool, kind: "site" });
    expect(sites.every((t) => t.kind === "site")).toBe(true);
    expect(sites.every((t) => t.status === "active")).toBe(true);
    const siteA = sites.find((t) => t.slug === "tpltest-site-a");
    expect(siteA?.pages_count).toBe(2);

    const pageKind = await listTemplates({ pool, kind: "page" });
    expect(pageKind.find((t) => t.slug === "tpltest-page-x")?.pages_count).toBe(1);
  });

  it("archiveTemplate flips status to archived and hides it from the active list", async () => {
    const { template } = await createTemplate(
      { slug: "tpltest-archive-me", name: "Archive Me", pages: [] },
      { pool },
    );
    const archived = await archiveTemplate(template.id, { pool });
    expect(archived?.status).toBe("archived");

    const active = await listTemplates({ pool, status: "active" });
    expect(active.find((t) => t.id === template.id)).toBeUndefined();
    const archivedList = await listTemplates({ pool, status: "archived" });
    expect(archivedList.find((t) => t.id === template.id)).toBeDefined();

    // Idempotent: archiving again still returns the row.
    const again = await archiveTemplate(template.id, { pool });
    expect(again?.status).toBe("archived");
  });

  it("archiveTemplate returns null for an unknown id", async () => {
    const res = await archiveTemplate("00000000-0000-0000-0000-000000000000", { pool });
    expect(res).toBeNull();
  });

  it("rejects a duplicate slug with TemplateSlugConflictError", async () => {
    await expect(
      createTemplate({ slug: "tpltest-site-a", name: "Dup", pages: [] }, { pool }),
    ).rejects.toBeInstanceOf(TemplateSlugConflictError);
  });

  it("rejects pages whose blocks fail registry validation (unknown type / bad props)", async () => {
    const err = await createTemplate(
      {
        slug: "tpltest-invalid",
        name: "Invalid",
        pages: [
          { slug: "bad", title: "Bad", blocks: [{ id: "x", type: "not-a-real-block", props: {} }] },
          { slug: "alsobad", title: "Also Bad", blocks: [{ id: "y", type: "rich-text", props: { max_width: "ginormous" } }] },
        ],
      },
      { pool },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(TemplateValidationError);
    const failures = (err as TemplateValidationError).failures;
    expect(failures.map((f) => f.page_slug).sort()).toEqual(["alsobad", "bad"]);
    expect(failures.find((f) => f.page_slug === "bad")!.failures[0].reason).toBe("unknown_type");
    expect(failures.find((f) => f.page_slug === "alsobad")!.failures[0].reason).toBe("invalid_props");

    // Nothing was persisted (validation runs before the transaction).
    const check = await pool.query(`SELECT 1 FROM templates WHERE slug = 'tpltest-invalid'`);
    expect(check.rowCount).toBe(0);
  });
});
