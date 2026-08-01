import type { Pool } from "pg";
import { pool as defaultPool } from "../src/server/db.js";
// Side-effect: register the static block types so the authored starter blocks
// are validated against the same registry the save/materialize paths use.
import "../src/blocks/index.js";
import { validateBlocks } from "../src/blocks/validate.js";
import { searchPixabay } from "../src/server/media/pixabay.js";
import { ingestImageFromUrl } from "../src/server/media/ingest.js";
import { handleMediaProcessUpload } from "../src/server/jobs/media-process-upload.js";
import type { ProcessedVariant } from "../src/server/media/variant-spec.js";
import { ensureSystemTemplatesSite } from "../src/server/templates/system-site.js";
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
 * COVER INGESTION (Task C4, fix round 1 — supersedes the original "store the
 * Pixabay CDN URL directly" design, which a review correctly rejected:
 * Pixabay's API terms restrict the URLs it returns to temporary display of
 * search results, not permanent hotlinking, and they rotate/expire).
 *
 * Covers now go through the REAL media pipeline:
 *   1. `ensureSystemTemplatesSite` finds-or-creates a reserved, unroutable
 *      `sites` row (`src/server/templates/system-site.ts`) — templates
 *      aren't real sites, but `media_assets.site_id` is `NOT NULL`, so
 *      ingestion needs *some* site to hang the asset off of.
 *   2. `ingestImageFromUrl` (`src/server/media/ingest.ts`) downloads the
 *      source (Pixabay hit or an authored `{ url }`) and lands it as a
 *      `media_assets` row under that site — same SSRF-guarded path every
 *      other image ingest in this codebase uses.
 *   3. Variant generation normally happens asynchronously via the
 *      `MEDIA_PROCESS_UPLOAD` pg-boss job — a seed script can't rely on a
 *      worker process being up to drain that queue, so this calls the job's
 *      handler (`handleMediaProcessUpload`) directly and synchronously
 *      instead of enqueuing it. Same function pg-boss would have invoked;
 *      just invoked in-process so the seed doesn't return before covers are
 *      actually ready. `tests/integration/media-process-upload.test.ts`
 *      already calls it the same direct way.
 *   4. The "md" (768px) variant's URL is stored as `cover_image_url`.
 *
 * Idempotence: a template whose `cover_image_url` is already non-null is left
 * alone — nothing is re-fetched or re-ingested for it. To pick up a new
 * query/URL for an already-covered template, null out that column by hand
 * first (a second `media_assets` row would otherwise accumulate under the
 * system site on every reseed).
 *
 * ATTRIBUTION: `ingestImageFromUrl`'s input shape is `{ siteId, url, alt,
 * contentType? }` and `media_assets` has no metadata/source-url column —
 * checked, neither supports recording where an image came from. Per this
 * task's brief, no column is added for it; the Pixabay hit id / source URL
 * is therefore NOT persisted anywhere beyond this run's logs. If per-image
 * attribution becomes a real requirement, that's a schema change for a
 * later task, not a seed-script workaround.
 *
 * CLEAN-SKIP environments: when `PIXABAY_API_KEY` is absent, `searchPixabay`
 * falls back to deterministic `example.invalid` stub hits (same convention
 * `src/server/ai/config.ts` uses) — those are never ingested. Separately,
 * `ingestImageFromUrl` / `handleMediaProcessUpload` need real GCS
 * credentials (`getStorage()` talks to actual Application Default
 * Credentials) — in an environment without them (most local/dev boxes, and
 * possibly the `deploy:db` migrate job itself, which this task does not
 * modify), the ingest/process call throws. Either failure mode is caught,
 * logged, and left as a null cover — seeding always succeeds regardless of
 * whether covers can be materialized. Prod covers backfill the next time
 * `db:seed-templates` runs somewhere with BOTH `PIXABAY_API_KEY` and GCS
 * storage credentials present.
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
  ingest?: typeof ingestImageFromUrl;
  processUpload?: typeof handleMediaProcessUpload;
  env?: NodeJS.ProcessEnv;
};

/** Prefers the "md" (768px) webp variant; falls back to md/jpg, then any variant. */
function pickCoverVariantUrl(variants: ProcessedVariant[]): string | null {
  const md = variants.filter((v) => v.name === "md");
  const webp = md.find((v) => v.format === "webp");
  if (webp) return webp.url;
  if (md.length > 0) return md[0].url;
  return variants[0]?.url ?? null;
}

/**
 * Resolves and persists a template's `cover_image_url` by ingesting it
 * through the real media pipeline under the reserved system site, or skips
 * cleanly (see the module header for both skip paths). Exported standalone
 * — unit-tested in tests/unit/seed-templates-cover.test.ts with the ingest
 * boundary faked (same injectable-deps pattern src/server/media/ingest.ts
 * itself uses) — and the system-site idempotence is covered by a DB-backed
 * integration test.
 */
export async function resolveTemplateCover(
  pool: Pool,
  templateId: string,
  cover: TemplateCoverSeed,
  systemSiteId: string,
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

  let sourceUrl: string;
  if ("url" in cover) {
    sourceUrl = cover.url;
  } else {
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
    sourceUrl = hits[0].largeImageURL;
  }

  const ingest = deps.ingest ?? ingestImageFromUrl;
  const processUpload = deps.processUpload ?? handleMediaProcessUpload;

  try {
    const { asset_id } = await ingest(pool, { siteId: systemSiteId, url: sourceUrl, alt: cover.alt });
    const { variants } = await processUpload({ asset_id }, { pool });
    const variantUrl = pickCoverVariantUrl(variants);
    if (!variantUrl) {
      console.log(
        `[seed-templates] cover ingest for template ${templateId} produced no variants — leaving cover_image_url null`,
      );
      return;
    }
    await pool.query(`UPDATE templates SET cover_image_url = $1 WHERE id = $2`, [variantUrl, templateId]);
  } catch (err) {
    // No GCS credentials in this environment (or any other ingest/process
    // failure) — clean skip, same contract as the no-PIXABAY_API_KEY path
    // above. Seeding must still succeed even when covers can't be
    // materialized here; they'll backfill on a run that has both secrets.
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[seed-templates] skipping cover ingestion for template ${templateId}: ${msg}`);
  }
}

export async function seedTemplates(
  pool: Pool = defaultPool,
): Promise<{ templates: number; pages: number; deregistered: number }> {
  // Validate every authored block up front (fail loudly on a typo). This is
  // the gate tasks C5-C14 rely on — every registered template must pass it.
  await validateAllTemplates(allTemplates);

  let pageCount = 0;
  let systemSiteId: string | null = null;

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
    // (Pixabay, GCS), which shouldn't happen while holding a checked-out
    // pool client. The system site is created lazily — only when some
    // registered template actually has a cover to resolve.
    if (tpl.cover) {
      if (!systemSiteId) systemSiteId = await ensureSystemTemplatesSite(pool);
      await resolveTemplateCover(pool, templateId, tpl.cover, systemSiteId);
    }
  }

  // D725 (W2-TERM) — dereg reconcile. The seed only ever UPSERTs the CURRENTLY
  // registered slugs; a built-in template removed from the registry
  // (db/templates/index.ts) otherwise keeps its DB row active + gallery-
  // visible forever with no code backing it. Archive any active BUILT-IN
  // template — `source_site_id IS NULL`, which uniquely marks seed rows
  // (operator save-as-template always stamps a source_site_id) — whose slug is
  // no longer registered. Archive, not delete: sites already materialized from
  // it keep working, and re-registering the slug (or D109 restore) revives it.
  const registeredSlugs = allTemplates.map((t) => t.slug);
  const dereg = await pool.query<{ slug: string }>(
    `UPDATE templates SET status = 'archived'
      WHERE source_site_id IS NULL
        AND status = 'active'
        AND slug <> ALL($1::text[])
     RETURNING slug`,
    [registeredSlugs],
  );
  if ((dereg.rowCount ?? 0) > 0) {
    console.log(
      `[seed-templates] archived ${dereg.rowCount} deregistered built-in template(s):`,
      dereg.rows.map((r) => r.slug),
    );
  }

  return { templates: allTemplates.length, pages: pageCount, deregistered: dereg.rowCount ?? 0 };
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
