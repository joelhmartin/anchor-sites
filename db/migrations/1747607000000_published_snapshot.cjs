/* eslint-disable camelcase */

// D301 snapshot-on-publish (W1.3 of the 2026-07-30 product-audit remediation).
//
// `published_snapshot` freezes the full render payload
// {title, blocks, seo, brand_tokens_override} at publish time; the tenant
// renderer serves ONLY this snapshot for status='published' pages, so
// post-publish edits to the working columns stay off the live site until the
// next publish. Full design: src/server/publish-snapshot.ts.
//
// Backfill: every currently-published row gets snapshot := its current
// content, so live sites render byte-identically across this deploy — the
// migration must never change what a live site serves. D504 rides along:
// `published_at` (existing column, previously written by seed only) is
// backfilled for published rows missing it; publish paths stamp it from now
// on.

exports.up = (pgm) => {
  pgm.addColumn("pages", {
    published_snapshot: { type: "jsonb" },
  });
  pgm.sql(`
    UPDATE pages
       SET published_snapshot = jsonb_build_object(
             'title', title,
             'blocks', blocks,
             'seo', seo,
             'brand_tokens_override', brand_tokens_override
           ),
           published_at = COALESCE(published_at, now())
     WHERE status = 'published'
  `);
};

exports.down = (pgm) => {
  // published_at values written by the backfill are left in place — dropping
  // real data on a down-migration would be worse than the noise.
  pgm.dropColumn("pages", "published_snapshot");
};
