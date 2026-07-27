import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../../tests/helpers/agent-db.js";
import { executeAgentTool } from "./index.js";
import { evictSiteCache, lookupSiteForDebug } from "../../../../middleware/resolveSite.js";
import type { AgentToolCtx } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: shared test DB, suite data isn't cleaned up
// afterward beyond what setupAgentDb().teardown() removes (see read.test.ts).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

d("agent settings tools", () => {
  let siteId: string;
  let otherSiteId: string;
  let pageId: string;
  let otherPageId: string;
  let ctx: AgentToolCtx;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite(`t6-settings-a-${runId}`)).id;
    otherSiteId = (await db.seedSite(`t6-settings-b-${runId}`)).id;
    pageId = (await db.seedPage(siteId, `home-${runId}`, [{ id: "b1", type: "hero", props: {} }])).id;
    otherPageId = (await db.seedPage(otherSiteId, `home-${runId}`, [])).id;
    ctx = {
      pool: db.getPool(),
      siteId,
      conversationId: "conv-test",
      env: {} as NodeJS.ProcessEnv,
    };
  });
  afterAll(() => db.teardown());

  describe("set_brand_tokens", () => {
    it("persists valid tokens and they re-read from sites", async () => {
      const result = await executeAgentTool(ctx, "set_brand_tokens", {
        tokens: { "--theme-main": "#112233" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.change).toEqual({
        kind: "site_updated",
        summary: expect.any(String),
      });

      const row = await db.getPool().query(`SELECT default_brand_tokens FROM sites WHERE id = $1`, [
        siteId,
      ]);
      expect(row.rows[0].default_brand_tokens).toEqual({ "--theme-main": "#112233" });
    });

    it("evicts the resolveSite cache for every hostname on the site", async () => {
      const hostname = `t6-cache-${runId}.example.test`;
      await db.getPool().query(
        `INSERT INTO site_domains (site_id, hostname, is_primary) VALUES ($1, $2, true)`,
        [siteId, hostname],
      );
      // Warm the cache with a bogus entry, then confirm the tool eviction
      // clears it (evictSiteCache is a pure in-memory operation — safe to
      // call directly in tests per the brief).
      evictSiteCache(hostname); // start clean
      const before = await lookupSiteForDebug(db.getPool(), hostname);
      expect(before.cache_hit).toBe(false);
      const cachedAgain = await lookupSiteForDebug(db.getPool(), hostname);
      expect(cachedAgain.cache_hit).toBe(true);

      const result = await executeAgentTool(ctx, "set_brand_tokens", {
        tokens: { "--theme-main": "#445566" },
      });
      expect(result.ok).toBe(true);

      const afterEviction = await lookupSiteForDebug(db.getPool(), hostname);
      expect(afterEviction.cache_hit).toBe(false);
    });

    it("rejects invalid token keys via the dispatcher", async () => {
      const result = await executeAgentTool(ctx, "set_brand_tokens", {
        tokens: { main: "#112233" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
    });

    it("rejects invalid token values via the dispatcher", async () => {
      const result = await executeAgentTool(ctx, "set_brand_tokens", {
        tokens: { "--theme-main": "not-a-color" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
    });
  });

  describe("set_seo_defaults", () => {
    it("persists valid seo defaults and they re-read from sites", async () => {
      const result = await executeAgentTool(ctx, "set_seo_defaults", {
        seo_defaults: { titleTemplate: "%s — Acme", twitterHandle: "@acme" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.change).toEqual({ kind: "site_updated", summary: expect.any(String) });

      const row = await db.getPool().query(`SELECT seo_defaults FROM sites WHERE id = $1`, [siteId]);
      expect(row.rows[0].seo_defaults).toEqual({
        titleTemplate: "%s — Acme",
        twitterHandle: "@acme",
      });
    });

    it("rejects invalid seo defaults via the dispatcher", async () => {
      // titleTemplate has no `.catch()` guard (unlike twitterHandle/
      // defaultOgImageAssetId, which are field-tolerant per schema.ts) — a
      // wrong type there is the one shape that fails validation instead of
      // being silently dropped.
      const result = await executeAgentTool(ctx, "set_seo_defaults", {
        seo_defaults: { titleTemplate: 123 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("invalid tool input");
    });
  });

  describe("set_page_seo", () => {
    it("updates seo and writes a revision row with the page's current blocks", async () => {
      const result = await executeAgentTool(ctx, "set_page_seo", {
        page_id: pageId,
        seo: { title: "Home", description: "Welcome" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { page_id: string; revision_id: string };
      expect(data.page_id).toBe(pageId);
      expect(data.revision_id).toBeTruthy();
      expect(result.change).toEqual({
        kind: "page_updated",
        page_id: pageId,
        revision_id: data.revision_id,
        summary: expect.any(String),
      });

      const pageRow = await db.getPool().query(`SELECT seo FROM pages WHERE id = $1`, [pageId]);
      expect(pageRow.rows[0].seo).toEqual({ title: "Home", description: "Welcome" });

      const revRow = await db.getPool().query(
        `SELECT page_id, source, blocks, seo FROM page_revisions WHERE id = $1`,
        [data.revision_id],
      );
      expect(revRow.rowCount).toBe(1);
      expect(revRow.rows[0].page_id).toBe(pageId);
      expect(revRow.rows[0].source).toBe("ai");
      expect(revRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: {} }]);
      expect(revRow.rows[0].seo).toEqual({ title: "Home", description: "Welcome" });
    });

    it("returns ok:false for a page belonging to another site, and writes no revision", async () => {
      const before = await db.getPool().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM page_revisions WHERE page_id = $1`,
        [otherPageId],
      );
      const result = await executeAgentTool(ctx, "set_page_seo", {
        page_id: otherPageId,
        seo: { title: "Hijacked" },
      });
      expect(result).toEqual({ ok: false, error: "page not found in this site" });

      const after = await db.getPool().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM page_revisions WHERE page_id = $1`,
        [otherPageId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });
});
