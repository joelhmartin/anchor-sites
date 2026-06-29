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

export type AdminCrmOptions = {
  pool?: Pool;
  crmClient?: CrmClient;
};

export function adminCrmRouter(opts: AdminCrmOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const crmClient = opts.crmClient ?? resolveCrmClient(process.env);
  const router = Router();
  const admin = requireAdmin();

  // GET /api/sites/:siteId/crm/phone-numbers
  router.get(
    "/sites/:siteId/crm/phone-numbers",
    admin,
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
