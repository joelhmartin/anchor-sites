import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Storage } from "@google-cloud/storage";
import { setupAgentDb } from "../../../../../tests/helpers/agent-db.js";
import { executeAgentTool } from "./index.js";
import { __setIngestDepsForTests } from "./assets.js";
import { createTemplate, archiveTemplate } from "../../../templates/repo.js";
import type { AgentToolCtx } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: shared test DB, see settings.test.ts for the
// same convention.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function fakeStorage() {
  const calls: Array<{ key: string }> = [];
  const storage = {
    bucket: () => ({
      file: (key: string) => ({
        save: async () => {
          calls.push({ key });
        },
      }),
    }),
  } as unknown as Storage;
  return { calls, storage };
}

d("agent asset tools", () => {
  let siteId: string;
  let emptySiteId: string;
  let ctx: AgentToolCtx;
  let siteTemplateId: string;
  let pageTemplateId: string;
  let archivedTemplateId: string;
  let emptySiteTemplateId: string;

  beforeAll(async () => {
    await db.runMigrations();
    ({ id: siteId } = await db.seedSite(`t7-assets-${runId}`));
    ({ id: emptySiteId } = await db.seedSite(`t7-assets-empty-${runId}`));
    ctx = {
      pool: db.getPool(),
      siteId,
      conversationId: "conv-test",
      env: {} as NodeJS.ProcessEnv,
    };

    const siteTpl = await createTemplate(
      {
        slug: `t7-site-tpl-${runId}`,
        name: "Site Template",
        kind: "site",
        pages: [
          {
            slug: "home",
            title: "Home",
            blocks: [{ id: "b1", type: "hero", props: {} }],
          },
        ],
      },
      { pool: db.getPool() },
    );
    siteTemplateId = siteTpl.template.id;

    const pageTpl = await createTemplate(
      { slug: `t7-page-tpl-${runId}`, name: "Page Template", kind: "page", pages: [] },
      { pool: db.getPool() },
    );
    pageTemplateId = pageTpl.template.id;

    const archivedTpl = await createTemplate(
      { slug: `t7-archived-tpl-${runId}`, name: "Archived Template", kind: "site", pages: [] },
      { pool: db.getPool() },
    );
    archivedTemplateId = archivedTpl.template.id;
    await archiveTemplate(archivedTemplateId, { pool: db.getPool() });

    // Active kind:'site' template with zero pages — the schema permits this
    // (templatePageInputSchema's `pages` array has no min-length), so
    // pages_created:0 alone can't distinguish "already has pages" from
    // "materialized a template that legitimately adds nothing" (review
    // finding, round 1).
    const emptySiteTpl = await createTemplate(
      { slug: `t7-empty-site-tpl-${runId}`, name: "Empty Site Template", kind: "site", pages: [] },
      { pool: db.getPool() },
    );
    emptySiteTemplateId = emptySiteTpl.template.id;
  });
  afterAll(async () => {
    // Clean up only what this file created (slug-prefixed, matching the
    // convention in tests/integration/templates-repo.test.ts:46); CASCADE
    // drops template_pages. db.teardown() only deletes seeded *sites*, not
    // templates, so without this templates orphan in the shared test DB.
    await db.getPool().query(`DELETE FROM templates WHERE slug LIKE 't7-%'`).catch(() => undefined);
    await db.teardown();
  });
  afterEach(() => __setIngestDepsForTests(null));

  describe("apply_site_template", () => {
    it("returns ok:false for an unknown template", async () => {
      const result = await executeAgentTool(ctx, "apply_site_template", {
        template_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(result).toEqual({ ok: false, error: "template not found" });
    });

    it("returns ok:false for a page-kind template", async () => {
      const result = await executeAgentTool(ctx, "apply_site_template", {
        template_id: pageTemplateId,
      });
      expect(result).toEqual({ ok: false, error: "template is not a site template" });
    });

    it("returns ok:false for an archived template", async () => {
      const result = await executeAgentTool(ctx, "apply_site_template", {
        template_id: archivedTemplateId,
      });
      expect(result).toEqual({ ok: false, error: "template is archived" });
    });

    it("materializes the template's pages into the site", async () => {
      const result = await executeAgentTool(ctx, "apply_site_template", {
        template_id: siteTemplateId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toMatchObject({ pages_created: 1, pages_skipped: 0 });
      expect(result.change).toEqual({ kind: "template_applied", summary: expect.any(String) });

      const rows = await db.getPool().query<{ slug: string }>(
        `SELECT slug FROM pages WHERE site_id = $1`,
        [siteId],
      );
      expect(rows.rows.map((r) => r.slug)).toEqual(["home"]);
    });

    it("returns ok:false once the site already has pages (idempotent apply)", async () => {
      const result = await executeAgentTool(ctx, "apply_site_template", {
        template_id: siteTemplateId,
      });
      expect(result).toEqual({ ok: false, error: "site already has pages; edit them instead" });
    });

    it("returns ok:true with pages_created:0 for a zero-page active site template on an empty site (not a misleading 'already has pages' error)", async () => {
      const emptyCtx: AgentToolCtx = { ...ctx, siteId: emptySiteId };
      const result = await executeAgentTool(emptyCtx, "apply_site_template", {
        template_id: emptySiteTemplateId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toMatchObject({ pages_created: 0, pages_skipped: 0 });
      expect(result.change).toEqual({ kind: "template_applied", summary: expect.any(String) });
    });
  });

  describe("search_stock_images", () => {
    it("returns 3 stub hits with download_url in the default (no API key) env", async () => {
      const result = await executeAgentTool(ctx, "search_stock_images", { query: "ocean" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { mode: string; hits: Array<Record<string, unknown>> };
      expect(data.mode).toBe("stub");
      expect(data.hits).toHaveLength(3);
      for (const hit of data.hits) {
        expect(typeof hit.download_url).toBe("string");
        expect(hit.download_url).toMatch(/^https:\/\/example\.invalid\//);
        expect(hit).toHaveProperty("credit");
        expect(hit).toHaveProperty("width");
        expect(hit).toHaveProperty("height");
      }
    });

    it("rejects a too-short query via the dispatcher", async () => {
      const result = await executeAgentTool(ctx, "search_stock_images", { query: "a" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
    });
  });

  describe("import_image", () => {
    it("imports a stub-hosted image with no network, using the injected storage/enqueue seam", async () => {
      const { storage, calls } = fakeStorage();
      const enqueued: Array<{ name: string; data: unknown }> = [];
      __setIngestDepsForTests({
        storage,
        enqueue: async (name, data) => {
          enqueued.push({ name, data });
          return "job-1";
        },
      });

      const result = await executeAgentTool(ctx, "import_image", {
        url: "https://example.invalid/stub-1-1280.jpg",
        alt: "a stub photo",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { asset_id: string; alt: string };
      expect(data.alt).toBe("a stub photo");
      expect(result.change).toEqual({ kind: "image_imported", summary: expect.any(String) });

      const row = await db.getPool().query(
        `SELECT alt, content_type FROM media_assets WHERE id = $1`,
        [data.asset_id],
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0]).toMatchObject({ alt: "a stub photo", content_type: "image/png" });

      // No real network call was made (stub fetch used) yet storage + enqueue
      // still ran, proving the deps seam merges cleanly with the stub short-circuit.
      expect(calls).toHaveLength(1);
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0].data).toEqual({ asset_id: data.asset_id });
    });

    it("D1117: passes the credit through and dedupes a repeat import (honest 'reused' summary, no change card)", async () => {
      const { storage, calls } = fakeStorage();
      __setIngestDepsForTests({ storage, enqueue: async () => "job-1" });

      const url = `https://example.invalid/stub-dedupe-${runId}.jpg`;
      const first = await executeAgentTool(ctx, "import_image", {
        url, alt: "a credited stub photo", credit: "Stub Photographer",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      const firstData = first.data as { asset_id: string; deduped: boolean };
      expect(firstData.deduped).toBe(false);
      expect(first.change).toBeDefined();

      const row = await db.getPool().query(
        `SELECT source_url, credit FROM media_assets WHERE id = $1`,
        [firstData.asset_id],
      );
      expect(row.rows[0]).toEqual({ source_url: url, credit: "Stub Photographer" });

      const second = await executeAgentTool(ctx, "import_image", {
        url, alt: "same image again",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("unreachable");
      const secondData = second.data as { asset_id: string; deduped: boolean };
      expect(secondData.asset_id).toBe(firstData.asset_id);
      expect(secondData.deduped).toBe(true);
      expect(second.summary).toMatch(/reused/i);
      // No change card — nothing new landed in the media library.
      expect(second.change).toBeUndefined();
      // Storage was only written once.
      expect(calls).toHaveLength(1);
    });

    it("rejects a too-short alt via the dispatcher", async () => {
      const result = await executeAgentTool(ctx, "import_image", {
        url: "https://example.invalid/x.jpg",
        alt: "ab",
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
    });
  });
});
