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
  let ctx: AgentToolCtx;
  let siteTemplateId: string;
  let pageTemplateId: string;
  let archivedTemplateId: string;

  beforeAll(async () => {
    await db.runMigrations();
    ({ id: siteId } = await db.seedSite(`t7-assets-${runId}`));
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
  });
  afterAll(() => db.teardown());
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
