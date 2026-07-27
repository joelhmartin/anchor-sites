import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { setupAgentDb } from "../../../../../tests/helpers/agent-db.js";
import { agentTools, executeAgentTool } from "./index.js";
import type { AgentTool, AgentToolCtx } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: the suite's own seeded data isn't cleaned up
// afterward (see agent-db.ts), and the DB is shared across concurrently
// running suites — a fixed slug would collide with a previous run of this
// same suite as well as with `t4-`-prefixed siblings.
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

d("agent read tools", () => {
  let siteId: string;
  let otherSiteId: string;
  let pageId: string;
  let otherPageId: string;
  let ctx: AgentToolCtx;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite(`t4-read-a-${runId}`)).id;
    otherSiteId = (await db.seedSite(`t4-read-b-${runId}`)).id;
    pageId = (await db.seedPage(siteId, "home", [{ id: "b1", type: "hero", props: {} }])).id;
    otherPageId = (await db.seedPage(otherSiteId, "home", [])).id;
    ctx = {
      pool: db.getPool(),
      siteId,
      conversationId: "conv-test",
      env: {} as NodeJS.ProcessEnv,
    };
  });
  afterAll(() => db.teardown());

  describe("get_site_overview", () => {
    it("lists only this site's pages, newest-updated first", async () => {
      const result = await executeAgentTool(ctx, "get_site_overview", {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as {
        site: { id: string; slug: string };
        pages: { id: string; slug: string }[];
        media_count: number;
        templates: unknown[];
      };
      expect(data.site.id).toBe(siteId);
      expect(data.site.slug).toBe(`t4-read-a-${runId}`);
      expect(data.pages.map((p) => p.id)).toContain(pageId);
      expect(data.pages.map((p) => p.id)).not.toContain(otherPageId);
      expect(typeof data.media_count).toBe("number");
      expect(Array.isArray(data.templates)).toBe(true);
    });
  });

  describe("get_page", () => {
    it("returns blocks for this site's page", async () => {
      const result = await executeAgentTool(ctx, "get_page", { page_id: pageId });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { id: string; blocks: unknown[] };
      expect(data.id).toBe(pageId);
      expect(data.blocks).toEqual([{ id: "b1", type: "hero", props: {} }]);
    });

    it("returns ok:false for a page belonging to another site", async () => {
      const result = await executeAgentTool(ctx, "get_page", { page_id: otherPageId });
      expect(result).toEqual({ ok: false, error: "page not found in this site" });
    });
  });

  describe("list_templates", () => {
    it("returns an array (empty when none seeded)", async () => {
      const result = await executeAgentTool(ctx, "list_templates", {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe("list_media", () => {
    it("returns an array (empty when none seeded)", async () => {
      const result = await executeAgentTool(ctx, "list_media", {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe("executeAgentTool dispatcher", () => {
    it("returns ok:false for an unknown tool", async () => {
      const result = await executeAgentTool(ctx, "nonexistent_tool", {});
      expect(result).toEqual({ ok: false, error: "unknown tool: nonexistent_tool" });
    });

    it("returns ok:false with details for invalid input", async () => {
      const result = await executeAgentTool(ctx, "get_page", {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
      expect(Array.isArray(result.details)).toBe(true);
    });

    it("catches a throwing tool's execute and returns ok:false with the error message", async () => {
      const throwingTool: AgentTool = {
        name: "t4_throwing_tool",
        description: "test-only tool that always throws",
        paramsSchema: z.object({}),
        execute: async () => {
          throw new Error("boom");
        },
      };
      agentTools.push(throwingTool);
      try {
        const result = await executeAgentTool(ctx, "t4_throwing_tool", {});
        expect(result).toEqual({ ok: false, error: "boom" });
      } finally {
        const idx = agentTools.indexOf(throwingTool);
        if (idx >= 0) agentTools.splice(idx, 1);
      }
    });
  });
});
