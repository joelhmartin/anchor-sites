import type { PoolClient } from "pg";
import { getDomainConfig, hostnameForSlug } from "../../config/domain.js";
import { seedSiteCopyIn } from "./copy-in.js";

/**
 * Shared site-creation primitive (P7-T7.6). Extracted from the inline logic in
 * `POST /api/sites` so both the new-site wizard (admin-sites) and the
 * create-from-template flow (templates) create sites identically: one `sites`
 * row + the canonical `<slug>.sites.anchorcorps.com` domain + the local-dev
 * `<slug>.localhost` domain (matching `db/seed.ts`).
 *
 * Runs inside a transaction the CALLER owns (BEGIN/COMMIT/ROLLBACK) so a site
 * can be created atomically alongside other work. Throws
 * `SiteSlugConflictError` if the slug is taken — the caller maps it to 409.
 */

export class SiteSlugConflictError extends Error {
  slug: string;
  constructor(slug: string) {
    super(`site slug "${slug}" already in use`);
    this.name = "SiteSlugConflictError";
    this.slug = slug;
  }
}

export async function createSiteWithDomains(
  client: PoolClient,
  opts: { slug: string; displayName: string; brandTokens?: Record<string, string> },
): Promise<{ siteId: string; canonical: string; canonicalDomainId: string }> {
  const dup = await client.query(`SELECT 1 FROM sites WHERE slug = $1`, [opts.slug]);
  if (dup.rowCount && dup.rowCount > 0) {
    throw new SiteSlugConflictError(opts.slug);
  }

  const siteRes = await client.query<{ id: string }>(
    `INSERT INTO sites (slug, display_name, default_brand_tokens)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [opts.slug, opts.displayName, JSON.stringify(opts.brandTokens ?? {})],
  );
  const siteId = siteRes.rows[0].id;

  const cfg = getDomainConfig();
  const canonical = hostnameForSlug(opts.slug, cfg);
  const localhostName = `${opts.slug}.localhost`;
  const domRes = await client.query<{ id: string }>(
    `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
     VALUES ($1, $2, true, 'pending', 'pending')
     RETURNING id`,
    [siteId, canonical],
  );
  const canonicalDomainId = domRes.rows[0].id;
  await client.query(
    `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
     VALUES ($1, $2, false, 'verified', 'active')`,
    [siteId, localhostName],
  );

  // P8-T8.12 (D-047): per-site copy-in — tenant auth config + starter content.
  await seedSiteCopyIn(client, siteId);

  return { siteId, canonical, canonicalDomainId };
}
