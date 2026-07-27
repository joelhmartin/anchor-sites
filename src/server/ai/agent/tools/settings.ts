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
  description: "Set the site's default brand tokens (CSS custom properties like --theme-main).",
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
    "Set the site's default SEO fields (title template, description, default og image, twitter handle).",
  paramsSchema: setSeoDefaultsParams,
  async execute(
    ctx: AgentToolCtx,
    input: z.infer<typeof setSeoDefaultsParams>,
  ): Promise<AgentToolResult> {
    await ctx.pool.query(`UPDATE sites SET seo_defaults = $1::jsonb WHERE id = $2`, [
      JSON.stringify(input.seo_defaults),
      ctx.siteId,
    ]);
    await evictSiteCacheForSite(ctx.pool, ctx.siteId);

    return {
      ok: true,
      data: { seo_defaults: input.seo_defaults },
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
    const pageRes = await ctx.pool.query<{ blocks: unknown }>(
      `SELECT blocks FROM pages WHERE id = $1 AND site_id = $2`,
      [input.page_id, ctx.siteId],
    );
    if (pageRes.rowCount === 0) {
      return { ok: false, error: "page not found in this site" };
    }
    const blocks = pageRes.rows[0].blocks;

    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");

      // Critical 1 (mirrors update_page in tools/pages.ts): the drawer's
      // Revert restores `change.revision_id`, so it must be the revision
      // that existed BEFORE this write, not the after-state revision this
      // call is about to create. Reuse the latest existing revision, or
      // synthesize a pre-write snapshot (current blocks + current seo) if
      // the page has none yet.
      const currentRes = await client.query<{ seo: Record<string, unknown> }>(
        `SELECT seo FROM pages WHERE id = $1`,
        [input.page_id],
      );
      const currentSeo = currentRes.rows[0]?.seo ?? {};

      const priorRevRes = await client.query<{ id: string }>(
        `SELECT id FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [input.page_id],
      );
      let priorRevisionId: string;
      if ((priorRevRes.rowCount ?? 0) > 0) {
        priorRevisionId = priorRevRes.rows[0].id;
      } else {
        const snapshotRes = await client.query<{ id: string }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, 'ai')
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
        `INSERT INTO page_revisions (page_id, blocks, seo, source)
         VALUES ($1, $2::jsonb, $3::jsonb, 'ai')
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
