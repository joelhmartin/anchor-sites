import type { PoolClient } from "pg";
import { getDomainConfig, hostnameForSlug } from "../../config/domain.js";
import { seedSiteCopyIn } from "./copy-in.js";
import { resolveCrmClient, type CrmEnv } from "../crm/resolve.js";
import type { CrmClient } from "../crm/client.js";
import { getBoss, CRM_SYNC_JOB, SITE_PROVISION } from "../jobs/index.js";
import type { CrmSyncInput } from "../crm/sync-job.js";
import type { SiteProvisionInput } from "../jobs/site-provision.js";

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
 *
 * FINAL whole-branch review, FIX-NOW item 4: the `site.provision` enqueue used
 * to happen HERE, inside that still-open transaction. Two problems, both real:
 * the worker (a separate connection, polling every ~2s) could pick the job up
 * before the site row was visible to it — the "site not found" race the job
 * handler's retry exists to paper over — and a rolled-back transaction still
 * left a queued job for a site that never existed. The enqueue is now returned
 * as an `enqueueProvision()` thunk the caller fires AFTER `COMMIT`, the same
 * shape `POST /api/sites/from-template` already uses for `enqueueMaterialize`
 * (routes/templates.ts).
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
): Promise<{
  siteId: string;
  canonical: string;
  canonicalDomainId: string;
  /** Fire AFTER the caller's COMMIT — see this function's doc comment.
   *  Never rejects: every failure mode is logged and swallowed, exactly as
   *  the in-transaction version was. Awaiting it (both callers do) keeps
   *  "the site was created" and "its provision job is queued" ordered for
   *  anything that inspects `pgboss.job` right after the response — it's a
   *  single INSERT on pg-boss's own pool, not a network round trip. */
  enqueueProvision: () => Promise<void>;
}> {
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

  // Task D1 (Lovable-workspace): auto-provision the canonical
  // *.sites.anchorcorps.com domain (Cloud Run mapping + DNS) so the preview
  // URL comes up without an operator visiting the Domains tab. Best-effort,
  // like CRM provisioning below — site creation must never block or fail on
  // it. `singletonKey: canonicalDomainId` so a retry (or a manual
  // "Provision" click before this job runs) collapses into whichever
  // attempt is already queued/active rather than double-queuing.
  // `retryLimit`/`retryDelay` give the Cloud Run/DNS calls a few automatic
  // retries (e.g. across the one-time Webmaster Central verification the
  // operator still needs to do — see docs/deploy.md §9) without hammering
  // either API indefinitely; failures land on the domain row's own status
  // fields via the job handler (src/server/jobs/site-provision.ts), visible
  // through the existing GET .../domains/:domainId/status poll.
  //
  // Final review item 4: built here (the ids are in scope) but NOT called —
  // the caller fires it after COMMIT.
  const enqueueProvision = async (): Promise<void> => {
    try {
      await getBoss()
        .send(
          SITE_PROVISION,
          { siteId, domainId: canonicalDomainId } satisfies SiteProvisionInput,
          { singletonKey: canonicalDomainId, retryLimit: 5, retryDelay: 60, retryBackoff: true },
        )
        .catch((err) => {
          // Fix round 1, item 1: this used to swallow the failure with zero
          // trace — a domain row stuck at verification_status='pending'
          // forever with nothing in the logs to explain why. Mirrors the CRM
          // enqueue's console.error below.
          // eslint-disable-next-line no-console
          console.error(
            `[provision] enqueue failed for site ${siteId} (domain ${canonicalDomainId}):`,
            err,
          );
        });
    } catch (err) {
      // Boss not started (JOBS_ENABLED=false or not yet booted) — skip; the
      // operator can trigger provisioning manually from the Domains tab.
      // eslint-disable-next-line no-console
      console.error(
        `[provision] enqueue failed for site ${siteId} (domain ${canonicalDomainId}):`,
        err,
      );
    }
  };

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

  return { siteId, canonical, canonicalDomainId, enqueueProvision };
}
