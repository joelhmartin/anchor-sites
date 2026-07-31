import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import migrate from "node-pg-migrate";
import { seed } from "../../db/seed.js";
import { pageRouter } from "../../src/server/routes/page.js";
import { __clearResolveSiteCacheForTests } from "../../src/middleware/resolveSite.js";

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

function buildApp(pool: Pool): express.Express {
  const app = express();
  app.use(pageRouter({ pool }));
  // Downstream fallback — mimics Vite/SPA in dev. Should only be reached
  // when resolveSite passes through on an unknown host.
  app.use((_req, res) => res.status(200).type("text/plain").send("DOWNSTREAM"));
  return app;
}

/**
 * D301 — the tenant route serves `published_snapshot`, not the working
 * columns; tests that mutate a page via direct SQL and want the mutation
 * VISIBLE on the live render must "publish" it, exactly like the publish
 * routes do (same jsonb_build_object as src/server/publish-snapshot.ts).
 */
async function publishWorkingCopy(pool: Pool, siteSlug: string, pageSlug: string): Promise<void> {
  await pool.query(
    `UPDATE pages
        SET status = 'published',
            published_snapshot = jsonb_build_object(
              'title', title, 'blocks', blocks, 'seo', seo,
              'brand_tokens_override', brand_tokens_override),
            published_at = now()
      WHERE site_id = (SELECT id FROM sites WHERE slug = $1) AND slug = $2`,
    [siteSlug, pageSlug],
  );
}

d("page renderer catch-all (integration)", () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    await runMigrate("up", Infinity);
    pool = new Pool({ connectionString: TEST_DB_URL });
    await seed(pool);
    app = buildApp(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  beforeEach(() => {
    __clearResolveSiteCacheForTests();
  });

  it("muldoon home renders with seeded hero text + SEO meta", async () => {
    const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Modern dental care, gentle hands.");
    expect(res.text).toContain("ac-hero");
    expect(res.text).toContain("ac-rich-text");
    expect(res.text).toContain("ac-cta");
    // SEO from pages.seo
    expect(res.text).toMatch(/<title>Muldoon Dental — Family \+ Cosmetic Dentistry<\/title>/);
    expect(res.text).toMatch(
      /<meta name="description" content="Family and cosmetic dentistry [^"]*"/,
    );
    // data-site-slug on <html>
    expect(res.text).toMatch(/data-site-slug="muldoon-dental"/);
    // Brand tokens injected
    expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
    // P9-T9.2 — SEO head: canonical + robots + OG wired through renderPage
    expect(res.text).toContain(
      '<link rel="canonical" href="https://muldoon-dental.sites.anchorcorps.com/" />',
    );
    expect(res.text).toContain('<meta name="robots" content="index,follow" />');
    expect(res.text).toContain('<meta property="og:type" content="website" />');
    // P9-T9.4 — JSON-LD baseline (Organization + WebSite + WebPage)
    expect(res.text).toContain('<script type="application/ld+json">');
    expect(res.text).toContain('"@type":"Organization"');
    expect(res.text).toContain('"@type":"WebSite"');
    expect(res.text).toContain('"@type":"WebPage"');
  });

  it("demo home renders different content + different brand tokens", async () => {
    const res = await request(app).get("/").set("Host", "demo-site.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Same renderer. Different site.");
    expect(res.text).not.toContain("Modern dental care, gentle hands.");
    expect(res.text).toMatch(/--theme-main:\s*#1f1f1f/);
    expect(res.text).toMatch(/data-site-slug="demo-site"/);
  });

  it("applies site-level SEO defaults (title template, twitter:site) — P9-T9.3", async () => {
    await pool.query(
      `UPDATE sites SET seo_defaults = $1::jsonb WHERE slug = 'demo-site'`,
      [JSON.stringify({ titleTemplate: "%s · Demo Co", twitterHandle: "democo" })],
    );
    __clearResolveSiteCacheForTests();
    const res = await request(app).get("/").set("Host", "demo-site.sites.anchorcorps.com");
    expect(res.status).toBe(200);
    // title wrapped by the template
    expect(res.text).toMatch(/<title>[^<]+ · Demo Co<\/title>/);
    expect(res.text).toContain('<meta name="twitter:site" content="@democo" />');
    // reset so other tests see a clean default
    await pool.query(`UPDATE sites SET seo_defaults = '{}'::jsonb WHERE slug = 'demo-site'`);
    __clearResolveSiteCacheForTests();
  });

  it("returns 404 (site-shelled) for an unknown slug on a known site", async () => {
    const res = await request(app)
      .get("/this-page-does-not-exist")
      .set("Host", "muldoon-dental.sites.anchorcorps.com");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Page not found/);
    // 404 still wears the site's brand
    expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
    // P9-T9.2 — a 404 must be noindex
    expect(res.text).toContain('<meta name="robots" content="noindex" />');
  });

  it("passes through to downstream when host is unknown (Vite/SPA fallback)", async () => {
    const res = await request(app).get("/").set("Host", "nope.example.com");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("admin host (studio.localhost) passes through to the SPA, never 404s as a tenant (P4-T4.1)", async () => {
    const res = await request(app).get("/sites").set("Host", "studio.localhost");
    expect(res.status).toBe(200);
    expect(res.text).toBe("DOWNSTREAM");
  });

  it("brand tokens differ between the two sites' rendered CSS", async () => {
    const m = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
    const d = await request(app).get("/").set("Host", "demo-site.sites.anchorcorps.com");
    const mTokens = m.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    const dTokens = d.text.match(/--theme-main:\s*([^;]+);/)?.[1].trim();
    expect(mTokens).toBe("#0a3d62");
    expect(dTokens).toBe("#1f1f1f");
    expect(mTokens).not.toBe(dTokens);
  });

  it("brand_tokens_override on a page wins per-key over the site default (P3-T3.5)", async () => {
    await pool.query(
      `UPDATE pages
          SET brand_tokens_override = $1::jsonb
        WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental')
          AND slug = 'home'`,
      [JSON.stringify({ "--theme-main": "#ff00aa" })],
    );
    await publishWorkingCopy(pool, "muldoon-dental", "home");
    try {
      const r = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(r.status).toBe(200);
      // Sanity: peek at the :root block of the SSR'd <style> tag.
      const rootBlock = r.text.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "(:root not found)";
      // Override wins for --theme-main.
      expect(rootBlock).toMatch(/--theme-main:\s*#ff00aa\s*;/);
      // Non-overridden site default still passes through (--theme-accent unchanged).
      expect(r.text).toMatch(/--theme-accent:\s*#f6b93b\s*;/);
    } finally {
      await pool.query(
        `UPDATE pages SET brand_tokens_override = NULL
          WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental')
            AND slug = 'home'`,
      );
      await publishWorkingCopy(pool, "muldoon-dental", "home");
    }
  });

  it("media hydration: <picture> srcset + width/height land in HTML when an Image block references a ready media_asset (P3-T3.14)", async () => {
    // Fixture asset that pretends 3.10's variant job already finished.
    const muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    const variants = [
      { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      { name: "md", format: "webp", width: 768, height: 432, url: "https://x/md.webp" },
      { name: "sm", format: "jpg", width: 480, height: 270, url: "https://x/sm.jpg" },
      { name: "md", format: "jpg", width: 768, height: 432, url: "https://x/md.jpg" },
    ];
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status, variants, width, height)
       VALUES ($1, $2, 'image/png', 'Fixture image', 'ready', $3::jsonb, 1280, 720) RETURNING id`,
      [muldoonId, `originals/${muldoonId}/hydration-fixture.png`, JSON.stringify(variants)],
    );
    const assetId = ins.rows[0].id;
    // Snapshot the muldoon home blocks so we can restore later.
    const before = await pool.query<{ blocks: unknown[] }>(
      `SELECT blocks FROM pages WHERE site_id = $1 AND slug = 'home'`,
      [muldoonId],
    );
    const originalBlocks = before.rows[0].blocks;
    try {
      const newBlocks = [
        ...originalBlocks,
        { id: "img-1", type: "image", props: { asset_id: assetId, alt: "Override alt" } },
      ];
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [JSON.stringify(newBlocks), muldoonId],
      );
      await publishWorkingCopy(pool, "muldoon-dental", "home");

      const r = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(r.status).toBe(200);
      expect(r.text).toContain("ac-image");
      // WebP source with sorted srcset
      expect(r.text).toMatch(
        /<source[^>]*type="image\/webp"[^>]*srcSet="https:\/\/x\/sm\.webp 480w, https:\/\/x\/md\.webp 768w"/i,
      );
      // JPG fallback uses the largest variant.
      expect(r.text).toMatch(/<img[^>]*src="https:\/\/x\/md\.jpg"/i);
      // Prop alt wins.
      expect(r.text).toMatch(/alt="Override alt"/);
      // Width/height hints landed.
      expect(r.text).toMatch(/width="1280"/);
      expect(r.text).toMatch(/height="720"/);
    } finally {
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [JSON.stringify(originalBlocks), muldoonId],
      );
      await publishWorkingCopy(pool, "muldoon-dental", "home");
      await pool.query(`DELETE FROM media_assets WHERE id = $1`, [assetId]);
    }
  });

  // ---------- D301 — snapshot-on-publish ----------

  it("D301: after a post-publish edit, the live site serves the SNAPSHOT, not the working blocks", async () => {
    const muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    const before = await pool.query<{ blocks: unknown[] }>(
      `SELECT blocks FROM pages WHERE site_id = $1 AND slug = 'home'`,
      [muldoonId],
    );
    try {
      // Simulate the agent / inline editor: mutate working blocks, DON'T publish.
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [
          JSON.stringify([
            { id: "leak-1", type: "rich-text", props: { html: "<p>UNPUBLISHED DRAFT EDIT</p>", max_width: "medium" } },
          ]),
          muldoonId,
        ],
      );
      const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(200);
      // Live still serves the published snapshot…
      expect(res.text).toContain("Modern dental care, gentle hands.");
      // …and the draft edit did NOT leak.
      expect(res.text).not.toContain("UNPUBLISHED DRAFT EDIT");
    } finally {
      await pool.query(
        `UPDATE pages SET blocks = $1::jsonb WHERE site_id = $2 AND slug = 'home'`,
        [JSON.stringify(before.rows[0].blocks), muldoonId],
      );
      await publishWorkingCopy(pool, "muldoon-dental", "home");
    }
  });

  it("D301: a published row with a NULL snapshot fails closed (404) — never leaks the working copy", async () => {
    const muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'no-snapshot', 'No Snapshot', '[]'::jsonb, '{}'::jsonb, 'published')
       RETURNING id`,
      [muldoonId],
    );
    try {
      const res = await request(app)
        .get("/no-snapshot")
        .set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(404);
    } finally {
      await pool.query(`DELETE FROM pages WHERE id = $1`, [ins.rows[0].id]);
    }
  });

  it("draft pages are not served (non-home slugs still 404)", async () => {
    const muldoonId = (
      await pool.query<{ id: string }>(`SELECT id FROM sites WHERE slug='muldoon-dental'`)
    ).rows[0].id;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
       VALUES ($1, 'draft-only', 'Draft Only', '[]'::jsonb, '{}'::jsonb, 'draft')
       RETURNING id`,
      [muldoonId],
    );
    try {
      const res = await request(app)
        .get("/draft-only")
        .set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(404);
      expect(res.text).toMatch(/Page not found/);
    } finally {
      await pool.query(`DELETE FROM pages WHERE id = $1`, [ins.rows[0].id]);
    }
  });

  // ---------- D904 — deliberate "coming soon" for an unpublished root ----------

  it("D904: a site with no published home serves a branded, noindex 'coming soon' at the root — not a 404", async () => {
    // flip muldoon home to draft, request "/", then restore.
    await pool.query(
      `UPDATE pages SET status = 'draft' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
    );
    try {
      const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/coming soon/i);
      // Deliberate page, not the 404 branch…
      expect(res.text).not.toMatch(/Page not found/);
      // …wearing the site's brand…
      expect(res.text).toContain("Muldoon Dental");
      expect(res.text).toMatch(/--theme-main:\s*#0a3d62/);
      // …and never indexed.
      expect(res.text).toContain('<meta name="robots" content="noindex" />');
      // The draft home's content must NOT leak into the placeholder.
      expect(res.text).not.toContain("Modern dental care, gentle hands.");
    } finally {
      await pool.query(
        `UPDATE pages SET status = 'published' WHERE site_id = (SELECT id FROM sites WHERE slug='muldoon-dental') AND slug = 'home'`,
      );
    }
  });

  // D911 — the muldoon seed's display_name is "Muldoon Dental (placeholder)"
  // and that marker reached og:site_name, JSON-LD and the page chrome on a
  // live index,follow page (verified live in the audit).
  describe("D911 — placeholder markers never reach the public render", () => {
    it("strips '(placeholder)' from og:site_name, JSON-LD and the body chrome", async () => {
      const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("(placeholder)");
      expect(res.text).toContain('<meta property="og:site_name" content="Muldoon Dental" />');
      expect(res.text).toContain('"name":"Muldoon Dental"');
      // The header/footer chrome shows the clean name.
      expect(res.text).toContain("Muldoon Dental");
    });
  });

  // D902 — normalizeSlug maps /home → the home page but never redirected, so
  // /home served a byte-identical duplicate of / with its own canonical
  // (verified live): one page, two indexable URLs, split canonicals.
  describe("D902 — /home permanently redirects to /", () => {
    it("301s /home (and /home/) to /", async () => {
      for (const path of ["/home", "/home/"]) {
        const res = await request(app)
          .get(path)
          .set("Host", "muldoon-dental.sites.anchorcorps.com")
          .redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe("/");
      }
    });

    it("preserves the query string across the redirect", async () => {
      const res = await request(app)
        .get("/home?utm_source=x")
        .set("Host", "muldoon-dental.sites.anchorcorps.com")
        .redirects(0);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe("/?utm_source=x");
    });

    it("does not redirect on admin/unknown hosts", async () => {
      const res = await request(app).get("/home").set("Host", "studio.localhost").redirects(0);
      expect(res.status).toBe(200);
      expect(res.text).toBe("DOWNSTREAM");
    });
  });

  // D914 — every tenant tab used to open icon-less AND fire a /favicon.ico
  // request that the catch-all answered with the full ~20 KB HTML 404 page.
  describe("D914 — tenant favicon", () => {
    it("shell emits a brand-colored data-URI icon link", async () => {
      const res = await request(app).get("/").set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(200);
      expect(res.text).toContain('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,');
      // Derived from the site's --theme-main brand token (#0a3d62, URI-encoded).
      expect(res.text).toContain("%230a3d62");
    });

    it("GET /favicon.ico terminates with a tiny cacheable icon, not the HTML 404 page", async () => {
      const res = await request(app)
        .get("/favicon.ico")
        .set("Host", "muldoon-dental.sites.anchorcorps.com");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      // supertest buffers non-text content types — read the raw body.
      const body = res.body instanceof Buffer ? res.body.toString("utf8") : String(res.text);
      expect(body).toContain("#0a3d62");
      expect(body).not.toContain("Page not found");
    });

    it("admin + unknown hosts fall through /favicon.ico to downstream (Studio serves its own)", async () => {
      const admin = await request(app).get("/favicon.ico").set("Host", "studio.localhost");
      expect(admin.text).toBe("DOWNSTREAM");
      const unknown = await request(app).get("/favicon.ico").set("Host", "nope.example.com");
      expect(unknown.text).toBe("DOWNSTREAM");
    });
  });
});
