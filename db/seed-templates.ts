import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";
// Side-effect: register the static block types so the authored starter blocks
// are validated against the same registry the save/materialize paths use.
import "../src/blocks/index.js";
import { validateBlocks } from "../src/blocks/validate.js";
import { searchPixabay } from "../src/server/media/pixabay.js";
import { allTemplates } from "./templates/index.js";
import type { TemplateCoverSeed, TemplateSeed } from "./templates/types.js";

/**
 * Seeds the template library (P7-T7.7, harness rebuilt in Task C4). Templates
 * are now authored one-per-file under `db/templates/*.ts` and collected in
 * `db/templates/index.ts`'s `allTemplates` — this module just seeds whatever
 * is registered there. Idempotent: UPSERTs each template by slug and replaces
 * its pages, so re-running refreshes content without duplicating. Authored
 * blocks are validated against the block registry before insert so a typo
 * fails loudly here rather than at materialize time.
 *
 * COVER INGESTION — design choice (Task C4):
 * `templates.cover_image_url` is a bare `text` column, not a foreign key into
 * `media_assets`. `media_assets` rows are mandatorily site-scoped (`site_id
 * uuid NOT NULL REFERENCES sites`, see db/migrations/1747573000000_media_
 * assets.cjs) and their variants are produced ASYNCHRONOUSLY by a pg-boss job
 * (MEDIA_PROCESS_UPLOAD) — there's no site a *template* naturally belongs to,
 * and waiting on a background job mid-seed (or provisioning a synthetic
 * "system" site just to hang cover assets off of) would add real complexity
 * for a gallery-card thumbnail. So: covers are resolved via Pixabay search
 * and the resulting CDN URL (`largeImageURL`) is stored directly in
 * `cover_image_url` — no download, no GCS re-host, no media_assets row.
 * Pixabay's API is designed to be hit this way (the API response IS the
 * asset URL meant for direct use in an application); this sidesteps the
 * site-scoping problem entirely rather than working around it.
 *
 * Idempotence: a template whose `cover_image_url` is already non-null is left
 * alone — Pixabay is never re-queried for it. To pick up a new query for an
 * already-covered template, null out that column by hand first.
 *
 * When `PIXABAY_API_KEY` is absent (CI/local without secrets), `searchPixabay`
 * falls back to deterministic `example.invalid` stub hits (same convention
 * `src/server/ai/config.ts` and git-sync's "disabled sentinel" use elsewhere)
 * — those are never written as a real cover; ingestion is skipped with a log
 * line and seeding still succeeds.
 */

/**
 * Validates every page's blocks of every template in the given list against
 * the block registry, throwing on the first failure. Exported so the
 * "allTemplates all validate" test (the gate tasks C5-C14 rely on) can call
 * it directly without going through a database.
 */
export async function validateAllTemplates(templates: TemplateSeed[]): Promise<void> {
  for (const tpl of templates) {
    for (const page of tpl.pages) {
      const failures = validateBlocks(page.blocks);
      if (failures.length > 0) {
        throw new Error(
          `seed-templates: template "${tpl.slug}" page "${page.slug}" has invalid blocks: ${JSON.stringify(failures)}`,
        );
      }
    }
  }
}

export type ResolveCoverDeps = {
  searchStock?: typeof searchPixabay;
  env?: NodeJS.ProcessEnv;
};

/**
 * Resolves and persists a template's `cover_image_url`, or skips cleanly.
 * Exported standalone (unit-tested in tests/unit/seed-templates-cover.test.ts)
 * since it's pure DB + injectable-search logic with no need for the full
 * migrate-a-real-database integration harness.
 */
export async function resolveTemplateCover(
  pool: Pool,
  templateId: string,
  cover: TemplateCoverSeed,
  deps: ResolveCoverDeps = {},
): Promise<void> {
  if (!cover) return;

  const existing = await pool.query<{ cover_image_url: string | null }>(
    `SELECT cover_image_url FROM templates WHERE id = $1`,
    [templateId],
  );
  if (existing.rows[0]?.cover_image_url) {
    // Already covered — skip (see idempotence note above; null the column to
    // force a re-resolve).
    return;
  }

  if ("url" in cover) {
    await pool.query(`UPDATE templates SET cover_image_url = $1 WHERE id = $2`, [cover.url, templateId]);
    return;
  }

  const search = deps.searchStock ?? searchPixabay;
  const env = deps.env ?? process.env;
  const { mode, hits } = await search(cover.stock_query, { env, perPage: 3 });
  if (mode === "stub" || hits.length === 0) {
    console.log(
      `[seed-templates] skipping cover ingestion for template ${templateId} (query "${cover.stock_query}") — ` +
        `${mode === "stub" ? "PIXABAY_API_KEY not set" : "no hits"}`,
    );
    return;
  }
  await pool.query(`UPDATE templates SET cover_image_url = $1 WHERE id = $2`, [hits[0].largeImageURL, templateId]);
}

export async function seedTemplates(
  pool: Pool = defaultPool,
): Promise<{ templates: number; pages: number }> {
  // Validate every authored block up front (fail loudly on a typo). This is
  // the gate tasks C5-C14 rely on — every registered template must pass it.
  await validateAllTemplates(allTemplates);

  let pageCount = 0;
  for (const tpl of allTemplates) {
    const client = await pool.connect();
    let templateId: string;
    try {
      await client.query("BEGIN");
      const tplRes = await client.query<{ id: string }>(
        `INSERT INTO templates (slug, name, description, kind, brand_tokens, category, sort_order)
         VALUES ($1, $2, $3, 'site', $4::jsonb, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           brand_tokens = EXCLUDED.brand_tokens,
           category = EXCLUDED.category,
           sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [tpl.slug, tpl.name, tpl.description, JSON.stringify(tpl.brand_tokens), tpl.category, tpl.sort_order],
      );
      templateId = tplRes.rows[0].id;

      // Replace pages so re-running refreshes content (no duplicates).
      await client.query(`DELETE FROM template_pages WHERE template_id = $1`, [templateId]);
      for (const page of tpl.pages) {
        await client.query(
          `INSERT INTO template_pages (template_id, slug, title, blocks, seo, sort_order)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
          [templateId, page.slug, page.title, JSON.stringify(page.blocks), JSON.stringify(page.seo), page.sort_order],
        );
        pageCount++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Outside the transaction: cover resolution may hit the network
    // (Pixabay), which shouldn't happen while holding a checked-out client.
    await resolveTemplateCover(pool, templateId, tpl.cover);
  }

  return { templates: allTemplates.length, pages: pageCount };
}

// CLI entry — `npm run db:seed-templates`
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  seedTemplates()
    .then((r) => {
      console.log(`[seed-templates] ok — ${r.templates} templates, ${r.pages} pages seeded/upserted`);
      return defaultPool.end();
    })
    .catch((err) => {
      console.error("[seed-templates] failed", err);
      defaultPool.end();
      process.exit(1);
    });
}
