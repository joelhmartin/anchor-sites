/**
 * P11-T11.8 (D-053) — Admin CRM proxy endpoints.
 *
 * Proxies CRM data reads from anchor-hub so the Studio frontend never
 * needs a direct CRM_API_KEY. All routes require requireAdmin().
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { resolveCrmClient } from "../crm/resolve.js";
import type { CrmClient } from "../crm/client.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";

export type AdminCrmOptions = {
  pool?: Pool;
  crmClient?: CrmClient;
  /** P12-T12.6 — injectable limit for phone-numbers proxy. Default 30/min. */
  phoneRateLimit?: RateLimitOptions;
};

export function adminCrmRouter(opts: AdminCrmOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const crmClient = opts.crmClient ?? resolveCrmClient(process.env);
  const router = Router();
  const admin = requireAdmin();
  // P12-T12.6: rate-limit the CRM proxy to prevent fan-out abuse.
  const phoneLimiter = rateLimit(opts.phoneRateLimit ?? { max: 30, windowMs: 60_000 });

  // POST /api/sites/:siteId/crm/provision — D425 retry-provision.
  //
  // The CRM site is provisioned once as a fire-and-forget step during site
  // creation (create-site.ts's `provisionCrm` thunk); if anchor-hub was
  // unreachable then, the site is left with `crm_site_id = NULL` and the
  // manage UI previously offered no recourse but recreating the site. This
  // re-runs exactly that provisioning call and persists the returned id. A
  // client that returns no id (CRM disabled / not configured) yields a 503 so
  // the UI can say "CRM isn't set up" rather than silently no-op.
  router.post(
    "/sites/:siteId/crm/provision",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const row = await pool.query<{ display_name: string; crm_site_id: string | null }>(
          `SELECT display_name, crm_site_id FROM sites WHERE id = $1`,
          [siteId],
        );
        if (!row.rowCount) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        // Already provisioned — idempotent success, don't double-create.
        if (row.rows[0].crm_site_id) {
          res.json({ crm_site_id: row.rows[0].crm_site_id, already_provisioned: true });
          return;
        }
        const domainRow = await pool.query<{ hostname: string }>(
          `SELECT hostname FROM site_domains WHERE site_id = $1 AND is_primary = true LIMIT 1`,
          [siteId],
        );
        const primaryDomain = domainRow.rows[0]?.hostname ?? "";
        const { crmSiteId } = await crmClient.provisionSite(
          siteId,
          row.rows[0].display_name,
          primaryDomain,
        );
        if (!crmSiteId) {
          res.status(503).json({
            error: "CRM isn't configured for this environment, so there's nothing to provision.",
          });
          return;
        }
        await pool.query(`UPDATE sites SET crm_site_id = $1 WHERE id = $2`, [crmSiteId, siteId]);
        res.json({ crm_site_id: crmSiteId });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/crm/phone-numbers
  router.get(
    "/sites/:siteId/crm/phone-numbers",
    admin,
    phoneLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const row = await pool.query<{ crm_site_id: string | null }>(
          `SELECT crm_site_id FROM sites WHERE id = $1`,
          [siteId],
        );
        if (!row.rowCount) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const { crm_site_id } = row.rows[0];
        if (!crm_site_id) {
          res.json({ phone_numbers: [] });
          return;
        }
        const phoneNumbers = await crmClient.listPhoneNumbers(crm_site_id);
        res.json({ phone_numbers: phoneNumbers });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
