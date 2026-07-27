import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../../tests/helpers/agent-db.js";
import { executeAgentTool } from "./index.js";
import type { AgentToolCtx } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: see read.test.ts for why (shared test DB,
// suite data isn't cleaned up afterward).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let genIdCounter = 0;
function makeGenId() {
  genIdCounter = 0;
  return () => `gen-${++genIdCounter}`;
}

d("agent page write tools", () => {
  let siteId: string;
  let otherSiteId: string;
  let ctx: AgentToolCtx;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite(`t5-pages-a-${runId}`)).id;
    otherSiteId = (await db.seedSite(`t5-pages-b-${runId}`)).id;
    ctx = {
      pool: db.getPool(),
      siteId,
      conversationId: "conv-test",
      env: {} as NodeJS.ProcessEnv,
      genId: makeGenId(),
    };
  });
  afterAll(() => db.teardown());

  describe("create_page", () => {
    it("creates a page + a revision row with source 'ai', and assigns block ids", async () => {
      const result = await executeAgentTool(ctx, "create_page", {
        slug: `about-${runId}`,
        title: "About",
        blocks: [{ type: "rich-text", props: { html: "<p>Hi</p>" } }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { page_id: string; revision_id: string };
      expect(data.page_id).toBeTruthy();
      expect(data.revision_id).toBeTruthy();
      expect(result.change).toEqual({
        kind: "page_created",
        page_id: data.page_id,
        revision_id: data.revision_id,
        summary: expect.any(String),
      });

      const pageRow = await db.getPool().query(
        `SELECT site_id, slug, title, blocks, status FROM pages WHERE id = $1`,
        [data.page_id],
      );
      expect(pageRow.rowCount).toBe(1);
      expect(pageRow.rows[0].site_id).toBe(siteId);
      expect(pageRow.rows[0].slug).toBe(`about-${runId}`);
      expect(pageRow.rows[0].status).toBe("draft");
      const blocks = pageRow.rows[0].blocks as { id: string; type: string }[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0].id).toBeTruthy();
      expect(blocks[0].type).toBe("rich-text");

      const revRow = await db.getPool().query(
        `SELECT page_id, source, blocks FROM page_revisions WHERE id = $1`,
        [data.revision_id],
      );
      expect(revRow.rowCount).toBe(1);
      expect(revRow.rows[0].page_id).toBe(data.page_id);
      expect(revRow.rows[0].source).toBe("ai");
    });

    it("rejects an unknown block type without writing anything", async () => {
      const result = await executeAgentTool(ctx, "create_page", {
        slug: `bogus-${runId}`,
        title: "Bogus",
        blocks: [{ type: "not-a-real-block", props: {} }],
      });
      expect(result).toEqual({
        ok: false,
        error: "block validation failed",
        details: expect.any(Array),
      });
      const rows = await db.getPool().query(`SELECT 1 FROM pages WHERE slug = $1`, [
        `bogus-${runId}`,
      ]);
      expect(rows.rowCount).toBe(0);
    });

    it("returns ok:false for a duplicate slug within the same site", async () => {
      const slug = `dupe-${runId}`;
      const first = await executeAgentTool(ctx, "create_page", { slug, title: "First", blocks: [] });
      expect(first.ok).toBe(true);
      const second = await executeAgentTool(ctx, "create_page", { slug, title: "Second", blocks: [] });
      expect(second).toEqual({ ok: false, error: "slug already in use" });
    });
  });

  describe("update_page", () => {
    it("applies ops, writes a revision, and returns a non-empty diff summary", async () => {
      const created = await executeAgentTool(ctx, "create_page", {
        slug: `update-me-${runId}`,
        title: "Update Me",
        blocks: [{ type: "rich-text", props: { html: "<p>Before</p>" } }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("unreachable");
      const { page_id } = created.data as { page_id: string };

      const before = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page_id]);
      const beforeBlockId = (before.rows[0].blocks as { id: string }[])[0].id;

      const result = await executeAgentTool(ctx, "update_page", {
        page_id,
        title: "Updated Title",
        ops: [
          {
            op: "update_block",
            id: beforeBlockId,
            props: { html: "<p>After</p>" },
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { page_id: string; revision_id: string; diff: { summary: string } };
      expect(data.diff.summary).not.toBe("No changes");
      expect(result.summary).toBe(data.diff.summary);
      expect(result.change?.kind).toBe("page_updated");

      const after = await db.getPool().query(`SELECT blocks, title FROM pages WHERE id = $1`, [page_id]);
      expect(after.rows[0].title).toBe("Updated Title");
      const afterBlocks = after.rows[0].blocks as { props: { html: string } }[];
      expect(afterBlocks[0].props.html).toBe("<p>After</p>");

      const rev = await db.getPool().query(`SELECT source FROM page_revisions WHERE id = $1`, [
        data.revision_id,
      ]);
      expect(rev.rows[0].source).toBe("ai");
    });

    it("returns ok:false for a page belonging to another site", async () => {
      const otherPage = await db.seedPage(otherSiteId, `other-${runId}`, []);
      const result = await executeAgentTool(ctx, "update_page", {
        page_id: otherPage.id,
        ops: [],
      });
      expect(result).toEqual({ ok: false, error: "page not found in this site" });
    });

    it("rejects an insert op with an unknown block type and leaves blocks unchanged", async () => {
      const created = await executeAgentTool(ctx, "create_page", {
        slug: `reject-insert-${runId}`,
        title: "Reject Insert",
        blocks: [{ type: "rich-text", props: { html: "<p>Stay</p>" } }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("unreachable");
      const { page_id } = created.data as { page_id: string };
      const before = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page_id]);

      const result = await executeAgentTool(ctx, "update_page", {
        page_id,
        ops: [
          {
            op: "insert_block",
            block: { type: "not-a-real-block", props: {} },
            place: "end",
          },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("proposal rejected at the validate stage");
      expect(result.details).toBeTruthy();

      const after = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [page_id]);
      expect(after.rows[0].blocks).toEqual(before.rows[0].blocks);
    });
  });

  describe("delete_page", () => {
    it("deletes a page when the site has more than one", async () => {
      const p1 = await executeAgentTool(ctx, "create_page", {
        slug: `del-a-${runId}`,
        title: "Del A",
        blocks: [],
      });
      const p2 = await executeAgentTool(ctx, "create_page", {
        slug: `del-b-${runId}`,
        title: "Del B",
        blocks: [],
      });
      if (!p1.ok || !p2.ok) throw new Error("unreachable");
      const { page_id } = p2.data as { page_id: string };

      const result = await executeAgentTool(ctx, "delete_page", { page_id });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.change?.kind).toBe("page_deleted");

      const row = await db.getPool().query(`SELECT 1 FROM pages WHERE id = $1`, [page_id]);
      expect(row.rowCount).toBe(0);
      void p1;
    });

    it("refuses to delete the only page in a site", async () => {
      const lonelySiteId = (await db.seedSite(`t5-lonely-${runId}`)).id;
      const lonelyPage = await db.seedPage(lonelySiteId, "home", []);
      const lonelyCtx: AgentToolCtx = { ...ctx, siteId: lonelySiteId };

      const result = await executeAgentTool(lonelyCtx, "delete_page", { page_id: lonelyPage.id });
      expect(result).toEqual({ ok: false, error: "cannot delete the only page" });

      const row = await db.getPool().query(`SELECT 1 FROM pages WHERE id = $1`, [lonelyPage.id]);
      expect(row.rowCount).toBe(1);
    });
  });
});
