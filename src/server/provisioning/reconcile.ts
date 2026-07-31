/**
 * D1024 (W2-DOM): Cloud Run domain mappings are per-tenant cloud resources —
 * they must be attributable (create stamps `metadata.labels.site_id`, see
 * run-domains.ts) and reconcilable. This is the list-and-compare pass:
 *
 *   - orphaned_mappings: a mapping exists but no `site_domains` row does —
 *     the residue of a failed delete-cleanup (pre-D1002), a slug rename, or
 *     a site deleted outside the app. These serve traffic for nobody and
 *     hold a hostname hostage.
 *   - unmapped_domains: a row exists but no mapping does — provisioning
 *     never completed (or the mapping was deleted out-of-band). These are
 *     the rows the operator expects to work but don't.
 *   - label_mismatches: mapping's site_id label disagrees with the row's
 *     owner (or the mapping predates labeling) — attribution is stale.
 *
 * `*.localhost` rows are excluded: they are dev-only conveniences that
 * never get Cloud Run mappings.
 *
 * Read-only: this REPORTS drift for the operator; it never deletes cloud
 * resources on its own.
 */

import type { Pool } from "pg";
import type { CloudRunDomainsClient } from "../gcloud/run-domains.js";

export type DomainReconcileReport = {
  orphaned_mappings: Array<{ hostname: string; labeled_site_id: string | null }>;
  unmapped_domains: Array<{ hostname: string; site_id: string }>;
  label_mismatches: Array<{
    hostname: string;
    labeled_site_id: string | null;
    row_site_id: string;
  }>;
  total_mappings: number;
  total_domains: number;
};

export async function reconcileDomainMappings(
  pool: Pool,
  cloudRun: CloudRunDomainsClient,
): Promise<DomainReconcileReport> {
  const [mappings, rows] = await Promise.all([
    cloudRun.list(),
    pool
      .query<{ hostname: string; site_id: string }>(
        `SELECT hostname, site_id FROM site_domains WHERE hostname NOT LIKE '%.localhost'`,
      )
      .then((r) => r.rows),
  ]);

  const rowByHostname = new Map(rows.map((r) => [r.hostname.toLowerCase(), r]));
  const mappingByHostname = new Map(
    mappings.map((m) => [m.metadata.name.toLowerCase(), m]),
  );

  const orphaned_mappings: DomainReconcileReport["orphaned_mappings"] = [];
  const label_mismatches: DomainReconcileReport["label_mismatches"] = [];
  for (const m of mappings) {
    const hostname = m.metadata.name.toLowerCase();
    const labeled = m.metadata.labels?.site_id ?? null;
    const row = rowByHostname.get(hostname);
    if (!row) {
      orphaned_mappings.push({ hostname, labeled_site_id: labeled });
    } else if (labeled !== row.site_id) {
      label_mismatches.push({ hostname, labeled_site_id: labeled, row_site_id: row.site_id });
    }
  }

  const unmapped_domains = rows
    .filter((r) => !mappingByHostname.has(r.hostname.toLowerCase()))
    .map((r) => ({ hostname: r.hostname, site_id: r.site_id }));

  return {
    orphaned_mappings,
    unmapped_domains,
    label_mismatches,
    total_mappings: mappings.length,
    total_domains: rows.length,
  };
}
