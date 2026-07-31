import { z } from "zod";
import type { AgentTool } from "./types.js";

/**
 * Read-only agent tools (Task 4). All queries are site-scoped against
 * `ctx.pool` — never trust a bare id from the model without an
 * `AND site_id = $2` (or equivalent) guard.
 */

const getSiteOverview: AgentTool = {
  name: "get_site_overview",
  description: "Get an overview of the current site: its settings, pages, media count, and active templates.",
  paramsSchema: z.object({}),
  async execute(ctx) {
    const siteResult = await ctx.pool.query(
      `SELECT id, slug, display_name, status, default_brand_tokens, seo_defaults
         FROM sites
        WHERE id = $1`,
      [ctx.siteId],
    );
    if (siteResult.rowCount === 0) {
      return { ok: false, error: "site not found" };
    }
    // D702: mirror the admin pages list — authored order (sort_order from
    // the materialized template) first, then creation order.
    const pagesResult = await ctx.pool.query(
      `SELECT id, slug, title, status, updated_at
         FROM pages
        WHERE site_id = $1
        ORDER BY sort_order ASC NULLS LAST, created_at ASC, slug ASC`,
      [ctx.siteId],
    );
    const mediaResult = await ctx.pool.query(
      `SELECT COUNT(*)::int AS count FROM media_assets WHERE site_id = $1`,
      [ctx.siteId],
    );
    const templatesResult = await ctx.pool.query(
      `SELECT id, slug, name, kind FROM templates WHERE status = 'active' ORDER BY name`,
    );
    return {
      ok: true,
      data: {
        site: siteResult.rows[0],
        pages: pagesResult.rows,
        media_count: mediaResult.rows[0].count,
        templates: templatesResult.rows,
      },
    };
  },
};

const getPageParams = z.object({ page_id: z.string().uuid() });

const getPage: AgentTool = {
  name: "get_page",
  description: "Get a single page's full content (blocks + SEO) by id.",
  paramsSchema: getPageParams,
  async execute(ctx, input: z.infer<typeof getPageParams>) {
    const result = await ctx.pool.query(
      `SELECT id, slug, title, status, blocks, seo
         FROM pages
        WHERE id = $1 AND site_id = $2`,
      [input.page_id, ctx.siteId],
    );
    if (result.rowCount === 0) {
      return { ok: false, error: "page not found in this site" };
    }
    return { ok: true, data: result.rows[0] };
  },
};

const listTemplatesParams = z.object({ kind: z.enum(["site", "page"]).optional() });

const listTemplates: AgentTool = {
  name: "list_templates",
  description: "List active templates available to apply, optionally filtered by kind (site|page).",
  paramsSchema: listTemplatesParams,
  async execute(ctx, input: z.infer<typeof listTemplatesParams>) {
    const conditions = ["status = 'active'"];
    const params: string[] = [];
    if (input.kind) {
      params.push(input.kind);
      conditions.push(`kind = $${params.length}`);
    }
    const result = await ctx.pool.query(
      `SELECT id, slug, name, kind FROM templates WHERE ${conditions.join(" AND ")} ORDER BY name`,
      params,
    );
    return { ok: true, data: result.rows };
  },
};

const listMedia: AgentTool = {
  name: "list_media",
  description: "List the site's media assets, most recently uploaded first (max 100).",
  paramsSchema: z.object({}),
  async execute(ctx) {
    const result = await ctx.pool.query(
      `SELECT id, alt, content_type, variants_status
         FROM media_assets
        WHERE site_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [ctx.siteId],
    );
    return { ok: true, data: result.rows };
  },
};

export const readTools: AgentTool[] = [getSiteOverview, getPage, listTemplates, listMedia];
