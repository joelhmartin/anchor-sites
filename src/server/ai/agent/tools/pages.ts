import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentTool, AgentToolCtx, AgentToolResult } from "./types.js";
import { applyAndValidate, editOpsSchema } from "../../edit-ops.js";
import { validateBlocks } from "../../../../blocks/validate.js";
import type { Block } from "../../../../blocks/types.js";
import { diffBlocks } from "../../diff.js";
// Side-effect: register the static block types so validateBlocks /
// applyAndValidate can validate against the registry (see propose.ts:7).
import "../../../../blocks/index.js";

/**
 * Page write tools (Task 5): create_page, update_page, delete_page. Mirrors
 * the transaction + revision pattern of `src/server/routes/admin-pages.ts`
 * (BEGIN → mutate pages → INSERT page_revisions with source 'ai' → COMMIT;
 * ROLLBACK on error) so AI writes go through the exact same guardrails
 * (block-registry validation, site-scoped queries) as the human save path.
 */

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "23505");
}

const createPageParams = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  blocks: z
    .array(z.object({ type: z.string().min(1), props: z.record(z.unknown()).default({}) }))
    .default([]),
});

const createPage: AgentTool = {
  name: "create_page",
  description: "Create a new page on the current site with the given slug, title, and initial blocks.",
  paramsSchema: createPageParams,
  async execute(ctx: AgentToolCtx, input: z.infer<typeof createPageParams>): Promise<AgentToolResult> {
    const genId = ctx.genId ?? nanoid;
    const blocks: Block[] = input.blocks.map((b) => ({
      id: genId(),
      type: b.type,
      props: b.props,
    }));

    const failures = validateBlocks(blocks);
    if (failures.length > 0) {
      return { ok: false, error: "block validation failed", details: failures };
    }

    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      const pageRes = await client.query<{ id: string }>(
        `INSERT INTO pages (site_id, slug, title, blocks, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft')
         RETURNING id`,
        [ctx.siteId, input.slug, input.title, JSON.stringify(blocks)],
      );
      const pageId = pageRes.rows[0].id;

      const revRes = await client.query<{ id: string }>(
        `INSERT INTO page_revisions (page_id, blocks, seo, source)
         VALUES ($1, $2::jsonb, '{}'::jsonb, 'ai')
         RETURNING id`,
        [pageId, JSON.stringify(blocks)],
      );
      const revisionId = revRes.rows[0].id;

      await client.query("COMMIT");

      return {
        ok: true,
        data: { page_id: pageId, revision_id: revisionId },
        summary: `Created page "${input.title}" (${input.slug}).`,
        change: {
          kind: "page_created",
          page_id: pageId,
          revision_id: revisionId,
          summary: `Created page "${input.title}" (${input.slug}).`,
        },
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(err)) {
        return { ok: false, error: "slug already in use" };
      }
      throw err;
    } finally {
      client.release();
    }
  },
};

const updatePageParams = z.object({
  page_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  ops: editOpsSchema,
});

const updatePage: AgentTool = {
  name: "update_page",
  description: "Apply a sequence of edit operations to an existing page's blocks, optionally renaming it.",
  paramsSchema: updatePageParams,
  async execute(ctx: AgentToolCtx, input: z.infer<typeof updatePageParams>): Promise<AgentToolResult> {
    const pageRes = await ctx.pool.query<{ blocks: Block[]; seo: Record<string, unknown> }>(
      `SELECT blocks, seo FROM pages WHERE id = $1 AND site_id = $2`,
      [input.page_id, ctx.siteId],
    );
    if (pageRes.rowCount === 0) {
      return { ok: false, error: "page not found in this site" };
    }
    const before = pageRes.rows[0].blocks;
    const seo = pageRes.rows[0].seo;

    const result = applyAndValidate(before, input.ops, { genId: ctx.genId });
    if (!result.ok) {
      return {
        ok: false,
        error: `proposal rejected at the ${result.stage} stage`,
        details: result.failures,
      };
    }
    const after = result.blocks;

    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE pages SET blocks = $1::jsonb, title = COALESCE($2, title), updated_at = now() WHERE id = $3`,
        [JSON.stringify(after), input.title ?? null, input.page_id],
      );
      const revRes = await client.query<{ id: string }>(
        `INSERT INTO page_revisions (page_id, blocks, seo, source)
         VALUES ($1, $2::jsonb, $3::jsonb, 'ai')
         RETURNING id`,
        [input.page_id, JSON.stringify(after), JSON.stringify(seo ?? {})],
      );
      const revisionId = revRes.rows[0].id;
      await client.query("COMMIT");

      const diff = diffBlocks(before, after);
      return {
        ok: true,
        data: { page_id: input.page_id, revision_id: revisionId, diff },
        summary: diff.summary,
        change: {
          kind: "page_updated",
          page_id: input.page_id,
          revision_id: revisionId,
          summary: diff.summary,
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

const deletePageParams = z.object({ page_id: z.string().uuid() });

const deletePage: AgentTool = {
  name: "delete_page",
  description: "Delete a page from the current site. Refuses to delete the site's only remaining page.",
  paramsSchema: deletePageParams,
  async execute(ctx: AgentToolCtx, input: z.infer<typeof deletePageParams>): Promise<AgentToolResult> {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock every page row for this site up front. This closes the TOCTOU
      // on the "only page" guard: a naive ownership-check + count + DELETE
      // done as three unsequenced queries lets two concurrent delete_page
      // calls against the last two pages of a site both pass the count
      // check and both delete, leaving zero pages. A concurrent transaction
      // running this same SELECT ... FOR UPDATE for the same site_id blocks
      // until this one commits or rolls back, so the count it sees is
      // always post-commit-accurate.
      const siteRows = await client.query<{ id: string }>(
        `SELECT id FROM pages WHERE site_id = $1 FOR UPDATE`,
        [ctx.siteId],
      );
      const exists = siteRows.rows.some((r) => r.id === input.page_id);
      if (!exists) {
        await client.query("ROLLBACK");
        return { ok: false, error: "page not found in this site" };
      }
      if ((siteRows.rowCount ?? 0) <= 1) {
        await client.query("ROLLBACK");
        return { ok: false, error: "cannot delete the only page" };
      }

      await client.query(`DELETE FROM pages WHERE id = $1 AND site_id = $2`, [
        input.page_id,
        ctx.siteId,
      ]);
      await client.query("COMMIT");

      return {
        ok: true,
        data: { page_id: input.page_id },
        summary: "Deleted page.",
        change: { kind: "page_deleted", page_id: input.page_id, summary: "Deleted page." },
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};

export const pageTools: AgentTool[] = [createPage, updatePage, deletePage];
