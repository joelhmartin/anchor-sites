import { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { brandTokensSchema } from "../../../../blocks/brand-tokens.js";
import { siteSeoDefaultsSchema, seoFieldsSchema } from "../../../seo/schema.js";
import { evictSiteCacheForSite } from "../../../../middleware/resolveSite.js";

/**
 * Site-settings tools (Task 6): set_brand_tokens, set_seo_defaults,
 * set_page_seo. Brand/SEO-default mutations evict the resolveSite cache for
 * every hostname the site could resolve under via `evictSiteCacheForSite`
 * (used the same way by `plugins.ts`'s toggle route) so the next request
 * sees fresh data without waiting out the 60s TTL. This covers both explicit
 * `site_domains` rows AND the canonical `<slug>.<base>` / `<slug>.localhost`
 * subdomain-fallback forms (`resolveSite.ts`'s `lookupSite` falls back to
 * subdomain matching when a site has no `site_domains` row at all) — an
 * inline `SELECT hostname FROM site_domains ...` loop (as in
 * `admin-sites.ts:253-257`) would miss that fallback and serve stale data up
 * to the TTL for any site resolved only by subdomain.
 * `set_page_seo` mirrors the transaction + revision pattern of
 * `tools/pages.ts` (`update_page`) so AI-driven SEO edits land in
 * `page_revisions` exactly like the human save path.
 */

const setBrandTokensParams = z.object({ tokens: brandTokensSchema });

const setBrandTokens: AgentTool = {
  name: "set_brand_tokens",
  description:
    "Set the site's default brand tokens (CSS custom properties like --theme-main). " +
    "REPLACES the entire token set — include every token you want kept, not just the ones you're changing.",
  paramsSchema: setBrandTokensParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof setBrandTokensParams>,
  ): Promise<AgentToolResult> {
    await ctx.pool.query(`UPDATE sites SET default_brand_tokens = $1::jsonb WHERE id = $2`, [
      JSON.stringify(input.tokens),
      ctx.siteId,
    ]);
    await evictSiteCacheForSite(ctx.pool, ctx.siteId);

    return {
      ok: true,
      data: { tokens: input.tokens },
      summary: "Brand tokens updated.",
      change: { kind: "site_updated", summary: "Brand tokens updated." },
    };
  },
};

const setSeoDefaultsParams = z.object({ seo_defaults: siteSeoDefaultsSchema });

const setSeoDefaults: AgentTool = {
  name: "set_seo_defaults",
  description:
    "Set the site's default SEO fields (title template, description, default og image, twitter handle). " +
    "MERGES with the existing defaults — fields you omit are left as they were.",
  paramsSchema: setSeoDefaultsParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof setSeoDefaultsParams>,
  ): Promise<AgentToolResult> {
    // Item 10 (CodeRabbit — overwrite semantics): unlike set_brand_tokens
    // (which intentionally stays replace-only — see its description), a
    // partial set_seo_defaults call must not silently drop fields the
    // model didn't mention this time (e.g. calling it again to just update
    // `twitterHandle` shouldn't blank out an already-set `titleTemplate`).
    // Read-modify-write, shallow merge: the new input's keys win, anything
    // it omits survives from the current row.
    const current = await ctx.pool.query<{ seo_defaults: Record<string, unknown> | null }>(
      `SELECT seo_defaults FROM sites WHERE id = $1`,
      [ctx.siteId],
    );
    const merged = { ...(current.rows[0]?.seo_defaults ?? {}), ...input.seo_defaults };

    await ctx.pool.query(`UPDATE sites SET seo_defaults = $1::jsonb WHERE id = $2`, [
      JSON.stringify(merged),
      ctx.siteId,
    ]);
    await evictSiteCacheForSite(ctx.pool, ctx.siteId);

    return {
      ok: true,
      data: { seo_defaults: merged },
      summary: "SEO defaults updated.",
      change: { kind: "site_updated", summary: "SEO defaults updated." },
    };
  },
};

const setPageSeoParams = z.object({ page_id: z.string().uuid(), seo: seoFieldsSchema });

const setPageSeo: AgentTool = {
  name: "set_page_seo",
  description: "Set a single page's SEO fields (title, description, canonical, robots, Open Graph, Twitter).",
  paramsSchema: setPageSeoParams,
  async execute(ctx: AgentToolCtx, input: z.infer<typeof setPageSeoParams>): Promise<AgentToolResult> {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");

      // Round 2 fix (Important 2d, mirrors update_page in tools/pages.ts):
      // read+lock the page row (blocks AND seo, in one query) INSIDE the
      // transaction with FOR UPDATE, instead of two separate unlocked
      // `ctx.pool`/`client` reads before and during the transaction. This
      // serializes concurrent set_page_seo calls on the same never-saved
      // page so a second call's "prior revision" lookup below always sees
      // the first call's already-committed snapshot rather than racing to
      // also synthesize one.
      const pageRes = await client.query<{ blocks: unknown; seo: Record<string, unknown> }>(
        `SELECT blocks, seo FROM pages WHERE id = $1 AND site_id = $2 FOR UPDATE`,
        [input.page_id, ctx.siteId],
      );
      if (pageRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, error: "page not found in this site" };
      }
      const blocks = pageRes.rows[0].blocks;
      const currentSeo = pageRes.rows[0].seo ?? {};

      // Critical 1: the drawer's Revert restores `change.revision_id`, so it
      // must be the revision that existed BEFORE this write, not the
      // after-state revision this call is about to create. Reuse the latest
      // existing revision, or synthesize a pre-write snapshot (current
      // blocks + current seo) if the page has none yet.
      //
      // Round 2 fix (Important 2c): `, id DESC` tiebreak — see the matching
      // comment in tools/pages.ts's update_page for the full rationale
      // (shared with `clock_timestamp()` below: makes revision ordering
      // unambiguous even under an exact `created_at` tie).
      const priorRevRes = await client.query<{ id: string }>(
        `SELECT id FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [input.page_id],
      );
      let priorRevisionId: string;
      if ((priorRevRes.rowCount ?? 0) > 0) {
        priorRevisionId = priorRevRes.rows[0].id;
      } else {
        // Round 2 fix (Important 2a/2b): `clock_timestamp()` (not the
        // transaction-constant `now()`) on BOTH inserts below keeps
        // revision timestamps strictly increasing within this transaction;
        // `source: 'ai-snapshot'` marks this row as a synthesized "before"
        // state, not a real write, in the revisions panel. See
        // tools/pages.ts's update_page for the full rationale.
        const snapshotRes = await client.query<{ id: string }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
           VALUES ($1, $2::jsonb, $3::jsonb, 'ai-snapshot', clock_timestamp())
           RETURNING id`,
          [input.page_id, JSON.stringify(blocks), JSON.stringify(currentSeo)],
        );
        priorRevisionId = snapshotRes.rows[0].id;
      }

      await client.query(
        `UPDATE pages SET seo = $1::jsonb, updated_at = now() WHERE id = $2 AND site_id = $3`,
        [JSON.stringify(input.seo), input.page_id, ctx.siteId],
      );
      const revRes = await client.query<{ id: string }>(
        `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
         VALUES ($1, $2::jsonb, $3::jsonb, 'ai', clock_timestamp())
         RETURNING id`,
        [input.page_id, JSON.stringify(blocks), JSON.stringify(input.seo)],
      );
      const afterRevisionId = revRes.rows[0].id;
      await client.query("COMMIT");

      return {
        ok: true,
        data: {
          page_id: input.page_id,
          revision_id: priorRevisionId,
          after_revision_id: afterRevisionId,
        },
        summary: "Page SEO updated.",
        change: {
          kind: "page_updated",
          page_id: input.page_id,
          revision_id: priorRevisionId,
          summary: "Page SEO updated.",
        },
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};

export const settingsTools: AgentTool[] = [setBrandTokens, setSeoDefaults, setPageSeo];
