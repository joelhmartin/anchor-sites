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
        // Critical 1: create_page's true inverse is delete_page, not restore
        // — there is no "prior" revision to restore to (the page didn't
        // exist). Deliberately omit `revision_id` from the change event so
        // the drawer's Revert button (gated on `change.revision_id`, see
        // AgentChatDrawer.tsx) doesn't render for a created page. `data`
        // above still carries the new page's initial revision id for
        // callers that need it (e.g. read tools).
        change: {
          kind: "page_created",
          page_id: pageId,
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
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");

      // Round 2 fix (Important 2d): read+lock the page row INSIDE the
      // transaction (was a separate, unlocked `ctx.pool.query` before
      // BEGIN). Without `FOR UPDATE`, two concurrent update_page calls on
      // the same never-saved page can both read zero prior revisions, both
      // decide to synthesize a snapshot, and race — this serializes them so
      // the second call's "prior revision" lookup below sees the first
      // call's already-committed snapshot instead of also snapshotting.
      const pageRes = await client.query<{ blocks: Block[]; seo: Record<string, unknown> }>(
        `SELECT blocks, seo FROM pages WHERE id = $1 AND site_id = $2 FOR UPDATE`,
        [input.page_id, ctx.siteId],
      );
      if (pageRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, error: "page not found in this site" };
      }
      const before = pageRes.rows[0].blocks;
      const seo = pageRes.rows[0].seo;

      const result = applyAndValidate(before, input.ops, { genId: ctx.genId });
      if (!result.ok) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: `proposal rejected at the ${result.stage} stage`,
          details: result.failures,
        };
      }
      const after = result.blocks;

      // Critical 1: the drawer's Revert button restores `change.revision_id`
      // — for that to actually undo THIS write, it must be the revision that
      // existed BEFORE the write below, not the after-state revision this
      // call is about to create (restoring the after-state onto itself is a
      // no-op). Find the latest existing revision first; if the page has
      // never been saved before (e.g. seeded directly, or created without
      // ever going through a save), synthesize one pre-write snapshot of the
      // current (pre-change) blocks+seo so there's always a genuine "before"
      // to restore to.
      //
      // Round 2 fix (Important 2c): `, id DESC` tiebreaks equal
      // `created_at` values (matches the `created_at DESC, id DESC` idiom
      // this codebase already uses for revision lists — see
      // admin-pages.ts's GET .../revisions route). This is belt-and-suspenders
      // alongside 2a below — with `clock_timestamp()` giving every revision
      // insert in this function a strictly increasing timestamp, ties
      // shouldn't happen at all anymore, but the tiebreak costs nothing and
      // keeps this query correct even if that ever changes.
      const priorRevRes = await client.query<{ id: string }>(
        `SELECT id FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [input.page_id],
      );
      let priorRevisionId: string;
      if ((priorRevRes.rowCount ?? 0) > 0) {
        priorRevisionId = priorRevRes.rows[0].id;
      } else {
        // Round 2 fix (Important 2a/2b): both revision inserts in this
        // transaction previously defaulted `created_at` to `now()`, which
        // is the TRANSACTION start time in Postgres — identical for both
        // inserts in the SAME transaction. That's harmless for the first
        // update_page call (nothing to tie against yet), but a SECOND
        // update_page call on the same page, in its own later transaction,
        // has its own `now()` — so no tie between transactions either.
        // The real bug this closes is subtler: without `clock_timestamp()`,
        // if this snapshot and the after-revision insert below ever landed
        // in the same statement/transaction snapshot as another write to
        // this page's revisions (e.g. a retried call, or future code
        // inserting revisions outside this exact transaction shape), an
        // exact-`now()` tie makes "the latest revision" ambiguous — the
        // plain `created_at DESC` order has no defined winner without the
        // `id DESC` tiebreak above, and the snapshot could sort AFTER the
        // real after-revision, so a later call's "prior revision" lookup
        // could pick the snapshot instead of the true latest state and
        // Revert would roll further back than intended. `clock_timestamp()`
        // (the actual wall-clock time at each individual statement, unlike
        // `now()`) plus the `id DESC` tiebreak makes revision ordering
        // unambiguous and monotonic within this transaction regardless.
        // `source: 'ai-snapshot'` (vs. the after-revision's `'ai'`) also
        // makes a synthesized snapshot visually distinct from a real write
        // in the revisions panel.
        const snapshotRes = await client.query<{ id: string }>(
          `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
           VALUES ($1, $2::jsonb, $3::jsonb, 'ai-snapshot', clock_timestamp())
           RETURNING id`,
          [input.page_id, JSON.stringify(before), JSON.stringify(seo ?? {})],
        );
        priorRevisionId = snapshotRes.rows[0].id;
      }

      await client.query(
        `UPDATE pages SET blocks = $1::jsonb, title = COALESCE($2, title), updated_at = now() WHERE id = $3`,
        [JSON.stringify(after), input.title ?? null, input.page_id],
      );
      const revRes = await client.query<{ id: string }>(
        `INSERT INTO page_revisions (page_id, blocks, seo, source, created_at)
         VALUES ($1, $2::jsonb, $3::jsonb, 'ai', clock_timestamp())
         RETURNING id`,
        [input.page_id, JSON.stringify(after), JSON.stringify(seo ?? {})],
      );
      const afterRevisionId = revRes.rows[0].id;
      await client.query("COMMIT");

      const diff = diffBlocks(before, after);
      return {
        ok: true,
        data: {
          page_id: input.page_id,
          // Prior (pre-change) revision — this is what Revert restores.
          revision_id: priorRevisionId,
          // After-state revision this write just created, kept for callers
          // that want the new revision id specifically (not used by Revert).
          after_revision_id: afterRevisionId,
          diff,
        },
        summary: diff.summary,
        change: {
          kind: "page_updated",
          page_id: input.page_id,
          revision_id: priorRevisionId,
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
  description:
    "Delete a page from the current site. Refuses to delete the site's only remaining page. " +
    "A full snapshot of the deleted page is kept server-side, so an accidental delete is recoverable by an operator.",
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

      // D1116 (W2-SEC) — tombstone BEFORE delete, same transaction. This was
      // the agent's only irreversible tool: page_revisions CASCADEs away with
      // the page, so the delete destroyed the very history that could undo
      // it. deleted_pages copies the full row (content + publish state), so
      // a model misfire is recoverable by re-inserting the payload as a new
      // page. W1.3 publish semantics need no extra 409 machinery here: the
      // FOR UPDATE lock above serializes against a concurrent publish's
      // UPDATE — whichever commits second sees the other's outcome (a
      // publish after this commit finds no row and 404s cleanly).
      const tombRes = await client.query<{ id: string }>(
        `INSERT INTO deleted_pages
           (site_id, page_id, slug, title, blocks, seo, brand_tokens_override,
            status, published_snapshot, sort_order, published_at, deleted_by)
         SELECT site_id, id, slug, title, blocks, seo, brand_tokens_override,
                status, published_snapshot, sort_order, published_at, 'ai'
           FROM pages WHERE id = $1 AND site_id = $2
         RETURNING id`,
        [input.page_id, ctx.siteId],
      );
      const tombstoneId = tombRes.rows[0].id;

      await client.query(`DELETE FROM pages WHERE id = $1 AND site_id = $2`, [
        input.page_id,
        ctx.siteId,
      ]);
      await client.query("COMMIT");

      return {
        ok: true,
        data: { page_id: input.page_id, tombstone_id: tombstoneId },
        summary: "Deleted page (a restorable snapshot was kept).",
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
