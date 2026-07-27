import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../../../tests/helpers/agent-db.js";
import { executeAgentTool } from "./index.js";
import { evictSiteCache, lookupSiteForDebug } from "../../../../middleware/resolveSite.js";
import { hostnameForSlug } from "../../../../config/domain.js";
import type { AgentToolCtx } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();
// Unique per test-process run: shared test DB, suite data isn't cleaned up
// afterward beyond what setupAgentDb().teardown() removes (see read.test.ts).
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

d("agent settings tools", () => {
  let siteId: string;
  let siteSlug: string;
  let otherSiteId: string;
  let pageId: string;
  let otherPageId: string;
  let ctx: AgentToolCtx;

  beforeAll(async () => {
    await db.runMigrations();
    ({ id: siteId, slug: siteSlug } = await db.seedSite(`t6-settings-a-${runId}`));
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

    it("evicts the resolveSite cache for an explicit site_domains hostname", async () => {
      const hostname = `t6-cache-${runId}.example.test`;
      await db.getPool().query(
        `INSERT INTO site_domains (site_id, hostname, is_primary) VALUES ($1, $2, true)`,
        [siteId, hostname],
      );
      // Warm the cache with a bogus entry, then confirm the tool eviction
      // clears it (evictSiteCache/lookupSiteForDebug are pure in-memory /
      // read operations — safe to call directly in tests per the brief).
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

    it("evicts the resolveSite cache for the canonical subdomain form even with no site_domains row", async () => {
      // Regression coverage for the review finding: a site can resolve via
      // the `<slug>.<base>` subdomain fallback (resolveSite.ts's lookupSite)
      // with NO site_domains row at all. An eviction loop that only reads
      // `site_domains` (the admin-sites.ts:253-257 pattern) would miss this
      // hostname entirely and leave it serving stale cached data until the
      // 60s TTL expires. evictSiteCacheForSite (used by settings.ts) must
      // cover this form too.
      const hostname = hostnameForSlug(siteSlug);
      evictSiteCache(hostname); // start clean
      const before = await lookupSiteForDebug(db.getPool(), hostname);
      expect(before.cache_hit).toBe(false);
      expect(before.site?.id).toBe(siteId);
      expect(before.site?.matched_via).toBe("subdomain");
      const cachedAgain = await lookupSiteForDebug(db.getPool(), hostname);
      expect(cachedAgain.cache_hit).toBe(true);

      const result = await executeAgentTool(ctx, "set_seo_defaults", {
        seo_defaults: { titleTemplate: "%s — Subdomain Check" },
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
      // `pageId` was seeded directly via db.seedPage — no page_revisions row
      // exists for it yet, so this exercises the Critical 1 "synthesize a
      // pre-write snapshot" branch (mirrors update_page in tools/pages.ts).
      const preCount = await db.getPool().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM page_revisions WHERE page_id = $1`,
        [pageId],
      );
      expect(preCount.rows[0].n).toBe(0);

      const result = await executeAgentTool(ctx, "set_page_seo", {
        page_id: pageId,
        seo: { title: "Home", description: "Welcome" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const data = result.data as { page_id: string; revision_id: string; after_revision_id: string };
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

      // Two revisions now exist: the synthesized pre-write snapshot
      // (data.revision_id — pre-change seo, i.e. '{}') and the after-write one.
      const revCount = await db.getPool().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM page_revisions WHERE page_id = $1`,
        [pageId],
      );
      expect(revCount.rows[0].n).toBe(2);

      // Critical 1: `data.revision_id` / `change.revision_id` must be the
      // PRE-change snapshot — restoring it (what the drawer's Revert button
      // does) must bring back the page's blocks AND its pre-change (empty)
      // seo, proving it's a true inverse of this write, not a no-op replay
      // of the write's own after-state.
      const revRow = await db.getPool().query(
        `SELECT page_id, source, blocks, seo FROM page_revisions WHERE id = $1`,
        [data.revision_id],
      );
      expect(revRow.rowCount).toBe(1);
      expect(revRow.rows[0].page_id).toBe(pageId);
      // Round 2 fix (Important 2b): a synthesized snapshot is tagged
      // 'ai-snapshot', distinct from a real write's 'ai'.
      expect(revRow.rows[0].source).toBe("ai-snapshot");
      expect(revRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: {} }]);
      expect(revRow.rows[0].seo).toEqual({});

      const afterRevRow = await db.getPool().query(
        `SELECT blocks, seo FROM page_revisions WHERE id = $1`,
        [data.after_revision_id],
      );
      expect(afterRevRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: {} }]);
      expect(afterRevRow.rows[0].seo).toEqual({ title: "Home", description: "Welcome" });
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
