import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { listBlocks } from "../../blocks/registry.js";
// Side-effect import so listBlocks() reflects the full registry, same as
// serialize.ts itself needs at module load.
import "../../blocks/index.js";
import {
  generateBlocksMd,
  generateReadme,
  pageFileName,
  parsePageFile,
  parseSiteFile,
  serializeSite,
  stableStringify,
} from "./serialize.js";

describe("stableStringify", () => {
  it("sorts nested object keys recursively", () => {
    const value = { b: 1, a: { d: 2, c: 3 }, e: [{ z: 1, y: 2 }] };
    const out = stableStringify(value);
    expect(out).toBe(
      `{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1,\n  "e": [\n    {\n      "y": 2,\n      "z": 1\n    }\n  ]\n}\n`,
    );
  });

  it("is deterministic regardless of property-insertion order", () => {
    const a = { one: 1, two: 2, nested: { x: 1, y: 2 } };
    const b = { nested: { y: 2, x: 1 }, two: 2, one: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("uses 2-space indent and ends with a trailing newline", () => {
    const out = stableStringify({ a: 1 });
    expect(out).toBe('{\n  "a": 1\n}\n');
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("pageFileName", () => {
  it("builds the pages/<slug>.json path", () => {
    expect(pageFileName("home")).toBe("pages/home.json");
    expect(pageFileName("about-us")).toBe("pages/about-us.json");
  });
});

describe("parsePageFile", () => {
  it("rejects malformed JSON with a path-bearing error", () => {
    const result = parsePageFile("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty("path");
    expect(result.errors[0]).toHaveProperty("message");
  });

  it("rejects a missing title with a path-bearing error", () => {
    const result = parsePageFile(
      JSON.stringify({ status: "draft", blocks: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.some((e) => e.path === "title")).toBe(true);
  });

  it("accepts a well-formed page file, defaulting seo to {}", () => {
    const result = parsePageFile(
      JSON.stringify({ title: "Home", status: "published", blocks: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.page.seo).toEqual({});
    expect(result.page.title).toBe("Home");
  });
});

describe("parseSiteFile", () => {
  it("rejects malformed JSON with a path-bearing error", () => {
    const result = parseSiteFile("not json at all");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]).toHaveProperty("path");
  });

  it("rejects a missing display_name", () => {
    const result = parseSiteFile(
      JSON.stringify({ default_brand_tokens: {}, seo_defaults: {} }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.some((e) => e.path === "display_name")).toBe(true);
  });
});

describe("generateBlocksMd", () => {
  it("contains every registered block's type name", () => {
    const md = generateBlocksMd();
    for (const { type } of listBlocks()) {
      expect(md).toContain(`\`${type}\``);
    }
  });
});

describe("generateReadme", () => {
  it("mentions the repo and the loop-prevention trailer", () => {
    const readme = generateReadme("acme/anchor-content");
    expect(readme).toContain("acme/anchor-content");
    expect(readme).toContain("Anchor-Sync: export");
  });
});

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("serializeSite", () => {
  let siteId: string;
  let siteSlug: string;
  let assetId: string;

  beforeAll(async () => {
    await db.runMigrations();
    ({ id: siteId, slug: siteSlug } = await db.seedSite("git-serialize"));

    const homeBlocks = [
      { id: "b1", type: "hero", props: { heading: "Welcome" } },
      { id: "b2", type: "rich-text", props: { html: "<p>Hi</p>" } },
    ];
    await db.seedPage(siteId, "home", homeBlocks);
    await db.seedPage(siteId, "about", [
      { id: "b1", type: "cta", props: {} },
    ]);

    const pool = db.getPool();
    // Publish "home" and give it a non-empty seo blob so the round-trip
    // check exercises both fields, not just the defaults.
    await pool.query(
      `UPDATE pages SET status = 'published', seo = $2::jsonb
        WHERE site_id = $1 AND slug = 'home'`,
      [siteId, JSON.stringify({ title: "Home | Acme" })],
    );

    const variants = [
      { name: "sm", format: "webp", width: 480, height: 270, url: "https://x/sm.webp" },
      { name: "md", format: "jpg", width: 768, height: 432, url: "https://x/md.jpg" },
    ];
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO media_assets
         (site_id, gcs_key, content_type, alt, variants_status, variants, width, height)
       VALUES ($1, $2, 'image/png', 'Fixture image', 'ready', $3::jsonb, 1280, 720)
       RETURNING id`,
      [siteId, `originals/${siteId}/serialize-fixture.png`, JSON.stringify(variants)],
    );
    assetId = ins.rows[0].id;

    // A non-ready asset must NOT appear in media.json.
    await pool.query(
      `INSERT INTO media_assets (site_id, gcs_key, content_type, alt, variants_status)
       VALUES ($1, $2, 'image/png', 'Pending', 'pending')`,
      [siteId, `originals/${siteId}/pending-fixture.png`],
    );
  });

  afterAll(() => db.teardown());

  it("yields exactly the expected key set", async () => {
    const files = await serializeSite(db.getPool(), siteId);
    expect(new Set(files.keys())).toEqual(
      new Set(["site.json", "pages/home.json", "pages/about.json", "media.json"]),
    );
  });

  it("produces a parseable site.json with domains/plugins as empty arrays", async () => {
    const files = await serializeSite(db.getPool(), siteId);
    const parsed = parseSiteFile(files.get("site.json")!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected success");
    expect(parsed.site.display_name).toBe(`Site ${siteSlug}`);
    expect(parsed.site.domains).toEqual([]);
    expect(parsed.site.plugins).toEqual([]);
  });

  it("round-trips a page's blocks exactly through pages/home.json", async () => {
    const files = await serializeSite(db.getPool(), siteId);
    const parsed = parsePageFile(files.get("pages/home.json")!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected success");
    expect(parsed.page.status).toBe("published");
    expect(parsed.page.seo).toEqual({ title: "Home | Acme" });
    expect(parsed.page.blocks).toEqual([
      { id: "b1", type: "hero", props: { heading: "Welcome" } },
      { id: "b2", type: "rich-text", props: { html: "<p>Hi</p>" } },
    ]);
  });

  it("round-trips the second page too", async () => {
    const files = await serializeSite(db.getPool(), siteId);
    const parsed = parsePageFile(files.get("pages/about.json")!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected success");
    expect(parsed.page.status).toBe("draft");
    expect(parsed.page.blocks).toEqual([{ id: "b1", type: "cta", props: {} }]);
  });

  it("includes only the ready media asset, with the {name,format,url} variant shape", async () => {
    const files = await serializeSite(db.getPool(), siteId);
    const media = JSON.parse(files.get("media.json")!);
    expect(Object.keys(media.assets)).toEqual([assetId]);
    expect(media.assets[assetId]).toEqual({
      alt: "Fixture image",
      content_type: "image/png",
      width: 1280,
      height: 720,
      variants: [
        { name: "sm", format: "webp", url: "https://x/sm.webp" },
        { name: "md", format: "jpg", url: "https://x/md.jpg" },
      ],
    });
  });

  it("is deterministic across repeated calls (no-op export contract)", async () => {
    const first = await serializeSite(db.getPool(), siteId);
    const second = await serializeSite(db.getPool(), siteId);
    expect(Object.fromEntries(first)).toEqual(Object.fromEntries(second));
  });
});
