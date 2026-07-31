import type { Pool } from "pg";
import { getTemplate } from "../templates/repo.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";

/**
 * pg-boss handler for `template.materialize` (P7-T7.5 / D-042).
 *
 * Materializes a template's pages into an existing site. Used by the
 * create-site-from-template flow (7.6): the endpoint creates the empty site +
 * domains, then enqueues this job.
 *
 * Idempotent by construction so pg-boss retries and re-runs are safe:
 *   - Pages insert with `ON CONFLICT (site_id, slug) DO NOTHING`, so a re-run
 *     only fills in pages that aren't there yet (counts created vs skipped).
 *   - Brand tokens are adopted ONLY when the site has none — once the first
 *     run sets them, later runs leave them untouched. This also preserves any
 *     brand tokens the operator chose at site-creation time (D-042).
 *
 * Media: captured blocks keep their source `asset_id`s; referenced images
 * render from the immutable public GCS variant URLs (D-043). No media copy.
 */

export type MaterializeTemplateInput = {
  siteId: string;
  templateId: string;
};

export type MaterializeTemplateDeps = {
  pool: Pool;
};

export type MaterializeTemplateResult = {
  site_id: string;
  template_id: string;
  pages_created: number;
  pages_skipped: number;
  brand_tokens_adopted: boolean;
};

export async function handleMaterializeTemplate(
  data: MaterializeTemplateInput,
  deps: MaterializeTemplateDeps,
): Promise<MaterializeTemplateResult> {
  const { siteId, templateId } = data;
  const pool = deps.pool;

  const siteRes = await pool.query<{ default_brand_tokens: Record<string, string> }>(
    `SELECT default_brand_tokens FROM sites WHERE id = $1`,
    [siteId],
  );
  if (siteRes.rowCount === 0) {
    throw new Error(`materialize-template: site not found: ${siteId}`);
  }
  const siteTokens = siteRes.rows[0].default_brand_tokens ?? {};

  const found = await getTemplate(templateId, { pool });
  if (!found) {
    throw new Error(`materialize-template: template not found: ${templateId}`);
  }
  const { template, pages } = found;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let created = 0;
    let skipped = 0;
    for (const page of pages) {
      // D716 publish-on-materialize: the from-template flow has ALREADY
      // enqueued `site.provision` for a public hostname, so materializing
      // as 'draft' meant a template-created site 404'd publicly forever
      // (no publish step exists anywhere in that create flow). Template
      // pages are finished content — they go live at materialize, with the
      // D301 snapshot + published_at the tenant route serves. Compose-mode
      // (template + prompt) rides the same path: the agent's follow-up
      // edits touch only the working columns, so they stay draft until the
      // operator publishes.
      const ins = await client.query<{ id: string }>(
        `INSERT INTO pages (site_id, slug, title, blocks, seo, status, published_snapshot, published_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'published',
                 jsonb_build_object(
                   'title', $3::text, 'blocks', $4::jsonb, 'seo', $5::jsonb,
                   'brand_tokens_override', NULL),
                 now())
         ON CONFLICT (site_id, slug) DO NOTHING
         RETURNING id`,
        [siteId, page.slug, page.title, JSON.stringify(page.blocks ?? []), JSON.stringify(page.seo ?? {})],
      );
      if (ins.rowCount && ins.rowCount > 0) {
        created++;
        await client.query(
          `INSERT INTO page_revisions (page_id, blocks, seo, source)
           VALUES ($1, $2::jsonb, $3::jsonb, 'import')`,
          [ins.rows[0].id, JSON.stringify(page.blocks ?? []), JSON.stringify(page.seo ?? {})],
        );
      } else {
        skipped++;
      }
    }

    // Adopt the template's brand tokens only if the site has none yet.
    const templateTokens = template.brand_tokens ?? {};
    const siteHasTokens = Object.keys(siteTokens).length > 0;
    const templateHasTokens = Object.keys(templateTokens).length > 0;
    let brandTokensAdopted = false;
    if (!siteHasTokens && templateHasTokens) {
      await client.query(
        `UPDATE sites SET default_brand_tokens = $1::jsonb WHERE id = $2`,
        [JSON.stringify(templateTokens), siteId],
      );
      brandTokensAdopted = true;
    }

    await client.query("COMMIT");

    // Evict the resolver cache so the renderer sees the new pages + tokens.
    const hosts = await pool.query<{ hostname: string }>(
      `SELECT hostname FROM site_domains WHERE site_id = $1`,
      [siteId],
    );
    for (const row of hosts.rows) evictSiteCache(row.hostname);

    return {
      site_id: siteId,
      template_id: templateId,
      pages_created: created,
      pages_skipped: skipped,
      brand_tokens_adopted: brandTokensAdopted,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
