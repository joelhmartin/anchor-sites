/**
 * P11-T11.7 (D-053) — pg-boss retry job for CRM sync failures.
 *
 * When any CRM call fails (provision, update, deprovision), the caller
 * enqueues a CRM_SYNC job so pg-boss retries it up to 3 times with
 * exponential back-off. The job re-derives the correct action from the
 * stored DB state, so retries are idempotent.
 */
import type { Pool } from "pg";
import { resolveCrmClient } from "./resolve.js";

export const CRM_SYNC_JOB = "crm.sync";

export type CrmSyncInput = {
  action: "provision" | "update" | "deprovision";
  siteId: string;
};

export type CrmSyncDeps = {
  pool: Pool;
};

export async function handleCrmSync(input: CrmSyncInput, deps: CrmSyncDeps): Promise<void> {
  const { action, siteId } = input;
  const { pool } = deps;

  const crmClient = resolveCrmClient(process.env);

  const row = await pool.query<{
    display_name: string;
    crm_site_id: string | null;
    primary_hostname: string | null;
    status: string;
  }>(
    `SELECT s.display_name, s.crm_site_id, s.status,
            (SELECT hostname FROM site_domains WHERE site_id = s.id AND is_primary = true LIMIT 1)
              AS primary_hostname
       FROM sites s WHERE s.id = $1`,
    [siteId],
  );

  if (!row.rowCount) {
    // Site deleted — nothing to do.
    return;
  }

  const site = row.rows[0];

  if (action === "provision") {
    const primary = site.primary_hostname ?? "";
    const result = await crmClient.provisionSite(siteId, site.display_name, primary);
    if (result.crmSiteId) {
      await pool.query(`UPDATE sites SET crm_site_id = $1 WHERE id = $2`, [
        result.crmSiteId,
        siteId,
      ]);
    }
  } else if (action === "update") {
    if (!site.crm_site_id) return;
    await crmClient.updateSite(site.crm_site_id, {
      name: site.display_name,
      primaryDomain: site.primary_hostname ?? undefined,
    });
  } else if (action === "deprovision") {
    if (!site.crm_site_id) return;
    await crmClient.deprovisionSite(site.crm_site_id);
  }
}
