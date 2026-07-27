import { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { brandTokensSchema } from "../../../../blocks/brand-tokens.js";
import { siteSeoDefaultsSchema, seoFieldsSchema } from "../../../seo/schema.js";
import { evictSiteCache } from "../../../../middleware/resolveSite.js";

/**
 * Site-settings tools (Task 6): set_brand_tokens, set_seo_defaults,
 * set_page_seo. Brand/SEO-default mutations evict the resolveSite cache for
 * every hostname pointing at the site (mirrors `admin-sites.ts:253-257`) so
 * the next request sees fresh data without waiting out the 60s TTL.
 * `set_page_seo` mirrors the transaction + revision pattern of
 * `tools/pages.ts` (`update_page`) so AI-driven SEO edits land in
 * `page_revisions` exactly like the human save path.
 */

async function evictAllHostnamesForSite(ctx: AgentToolCtx): Promise<void> {
  const hosts = await ctx.pool.query<{ hostname: string }>(
    `SELECT hostname FROM site_domains WHERE site_id = $1`,
    [ctx.siteId],
  );
  for (const row of hosts.rows) evictSiteCache(row.hostname);
}

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
    await evictAllHostnamesForSite(ctx);

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
    await evictAllHostnamesForSite(ctx);

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
      const revisionId = revRes.rows[0].id;
      await client.query("COMMIT");

      return {
        ok: true,
        data: { page_id: input.page_id, revision_id: revisionId },
        summary: "Page SEO updated.",
        change: {
          kind: "page_updated",
          page_id: input.page_id,
          revision_id: revisionId,
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
