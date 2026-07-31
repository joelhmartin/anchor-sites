/**
 * D301 snapshot-on-publish — design + the shared SQL that implements it.
 *
 * PROBLEM (audit workspace.md D301): the tenant route rendered the CURRENT
 * `blocks` of any `status='published'` page, and none of the ongoing edit
 * paths (agent `update_page`, inline-editor saves, the SEO tab / agent
 * `settings` tool) touch `status` — so after a page's FIRST publish, every
 * subsequent edit shipped to the live site instantly while the workspace's
 * Publish pill showed "Nothing to publish". The release gate the UI promised
 * did not exist.
 *
 * DESIGN — `pages.published_snapshot jsonb`: the frozen render payload
 * `{title, blocks, seo, brand_tokens_override}` — exactly the `PageRecord`
 * shape `render-page.tsx` consumes. Deliberately the WHOLE payload, not just
 * `blocks` (the audit's minimal suggestion): render-page.tsx renders `title`,
 * `seo`, and `brand_tokens_override` from the page row too, and each has
 * live writers that skip `status` (tools/pages.ts `update_page` COALESCEs
 * title; tools/settings.ts + the save route write seo/brand override) — a
 * blocks-only snapshot would leave title/SEO edits shipping live and the
 * pill still lying about them.
 *
 * RULES:
 *  - Publishing (any path that sets status='published') copies the working
 *    columns into `published_snapshot` and stamps `published_at = now()`
 *    (D504: "when did this last go live"; the sitemap's <lastmod> reads it).
 *  - Live tenant rendering (routes/page.ts) serves ONLY the snapshot, and
 *    fails closed: a published row with a NULL snapshot does not render —
 *    never leak a draft. The migration backfills every already-published row
 *    (snapshot := current content) so live sites render identically across
 *    the deploy.
 *  - Preview / workspace / editor / AI tools keep reading+writing the
 *    working columns — drafts diverge from live until the next publish.
 *  - "Has unpublished changes" (the Publish pill / bulk-publish WHERE) is
 *    `status <> 'published' OR <working payload> IS DISTINCT FROM
 *    published_snapshot` — jsonb equality is structural, so key order never
 *    false-positives.
 *  - Unpublish (status → 'draft') clears `published_at` (mirrors blog/repo)
 *    and RETAINS the snapshot: the status gate already hides it, and keeping
 *    it makes a later re-publish diff cheap.
 *
 * WHO SNAPSHOTS: the bulk publish route, the single-page save when the
 * payload says status:'published', git-import applying a page file whose
 * `status` field says 'published' (the file's status is a declared release
 * state; honoring it keeps the repo round-trip able to update live sites,
 * as it always could), materialize-template (D716: template sites go live
 * at creation), and db/seed.ts.
 *
 * DELIBERATELY NOT SNAPSHOTTED:
 *  - media_assets — shared library; alt/variant changes propagate to live
 *    pages immediately (unchanged behavior; snapshotting media would need a
 *    variant-pinning story that belongs to a media-versioning effort).
 *  - site-level fields (default_brand_tokens, seo_defaults, ctm/analytics)
 *    — site configuration, live-instant by design.
 *  - posts/events — separate tables with an explicit per-item status control
 *    in their editors; their update-a-published-post-updates-live semantics
 *    are the conventional CMS model, and the dishonest "Nothing to publish"
 *    pill does not exist for them. Same-pattern review flagged for W2.
 *  - git EXPORT — serialize.ts keeps exporting the WORKING columns
 *    (blocks/status): the content repo is the authoring mirror ("database is
 *    the source of truth", its own README), import regenerates the snapshot
 *    when it applies a published file, and exporting the snapshot too would
 *    double every page file while making repo edits unable to stage drafts.
 */

/**
 * The working-copy render payload as a jsonb value — MUST stay in key-sync
 * with what publish writes into `published_snapshot` (and with `PageRecord`
 * in render-page.tsx). A SQL-NULL brand_tokens_override becomes JSON null;
 * every writer uses this same expression, so comparisons are self-consistent.
 */
export const PAGE_SNAPSHOT_SQL = `jsonb_build_object(
  'title', title,
  'blocks', blocks,
  'seo', seo,
  'brand_tokens_override', brand_tokens_override
)`;

/**
 * True when the page would change the live site if published now — drives
 * the bulk-publish WHERE clause and the pages-list `has_unpublished_changes`
 * flag (the workspace Publish pill's count).
 */
export const PAGE_HAS_UNPUBLISHED_CHANGES_SQL = `(status <> 'published' OR ${PAGE_SNAPSHOT_SQL} IS DISTINCT FROM published_snapshot)`;
