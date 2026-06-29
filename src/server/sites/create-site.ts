import type { PoolClient } from "pg";
import { getDomainConfig, hostnameForSlug } from "../../config/domain.js";
import { seedSiteCopyIn } from "./copy-in.js";
import { resolveCrmClient, type CrmEnv } from "../crm/resolve.js";
import type { CrmClient } from "../crm/client.js";
import { getBoss, CRM_SYNC_JOB } from "../jobs/index.js";
import type { CrmSyncInput } from "../crm/sync-job.js";

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
  opts: {
    slug: string;
    displayName: string;
    brandTokens?: Record<string, string>;
    /** Injectable CRM client for tests. Defaults to resolveCrmClient(). */
    crmClient?: CrmClient;
    /** Injectable env for CRM client resolution. Defaults to process.env. */
    crmEnv?: CrmEnv;
  },
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

  // P11-T11.7 (D-053): best-effort CRM provisioning. Never blocks site creation.
  const crmClient = opts.crmClient ?? resolveCrmClient(opts.crmEnv);
  try {
    const { crmSiteId } = await crmClient.provisionSite(siteId, opts.displayName, canonical);
    if (crmSiteId) {
      await client.query(`UPDATE sites SET crm_site_id = $1 WHERE id = $2`, [crmSiteId, siteId]);
    }
  } catch (err) {
    // Best-effort: log and continue. Enqueue crm.sync retry job so pg-boss retries
    // up to 3× with back-off (T11.7 / D-053). Boss may not be started in test env —
    // that failure is also swallowed so site creation is never blocked.
    // eslint-disable-next-line no-console
    console.error("[crm] provisionSite failed — site creation continues:", err);
    try {
      void getBoss().send(
        CRM_SYNC_JOB,
        { action: "provision", siteId } satisfies CrmSyncInput,
        { retryLimit: 3 },
      );
    } catch {
      // Boss not started (JOBS_ENABLED=false or not yet booted) — skip retry enqueue.
    }
  }

  return { siteId, canonical, canonicalDomainId };
}
