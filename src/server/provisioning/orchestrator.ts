/**
 * Provision a tenant hostname end-to-end.
 *
 * Step order (each step is idempotent — re-running the orchestrator is
 * safe and useful when DNS or cert state is uncertain):
 *
 *   1. Resolve site by ID, compute canonical hostname `<slug>.<base>`.
 *   2. UPSERT `site_domains` row so the renderer can resolve the hostname
 *      via the explicit-domain path immediately.
 *   3. Kinsta DNS: list records, skip if a CNAME by that name already
 *      exists; otherwise create CNAME → `ghs.googlehosted.com.` and poll
 *      the Kinsta operation to terminal status.
 *   4. Cloud Run: createIfMissing the domain mapping for the hostname.
 *   5. (Optional) wait for the mapping to report Ready +
 *      CertificateProvisioned both True.
 *
 * Designed to be called from both the admin HTTP endpoint and a CLI
 * script — same logic, same env contract.
 */

import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import {
  getDomainConfig,
  hostnameForSlug,
  type DomainConfig,
} from "../../config/domain.js";
import { KinstaClient } from "../kinsta/client.js";
import {
  CloudRunDomainsClient,
  type DomainMapping,
} from "../gcloud/run-domains.js";

export type ProvisionStep = "lookup" | "site_domains" | "kinsta" | "cloud_run" | "wait_ready";

export type ProvisionStepResult =
  | { step: ProvisionStep; status: "skipped"; detail: string }
  | { step: ProvisionStep; status: "ok"; detail?: string; data?: unknown }
  | { step: ProvisionStep; status: "error"; detail: string };

export type ProvisionResult = {
  site_id: string;
  slug: string;
  hostname: string;
  steps: ProvisionStepResult[];
  ready: boolean;
  cloud_run_mapping?: DomainMapping;
};

export type ProvisionOptions = {
  pool?: Pool;
  kinsta?: KinstaClient;
  cloudRun?: CloudRunDomainsClient;
  domainConfig?: DomainConfig;
  /** Wait for Cloud Run cert to be ready before returning. Default false. */
  wait?: boolean;
  /** Override timeout for the wait step. */
  waitTimeoutMs?: number;
};

/**
 * Look up a site_id from a slug. Throws if no match.
 */
export async function siteIdFromSlug(
  slug: string,
  pool: Pool = defaultPool,
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM sites WHERE slug = $1`,
    [slug],
  );
  if (r.rowCount === 0) {
    throw new Error(`no site with slug ${JSON.stringify(slug)}`);
  }
  return r.rows[0].id;
}

/**
 * Provision a tenant hostname for an existing site (by id).
 *
 * The site must already exist in the `sites` table. Use this for both
 * "first time" and "retry" — every step checks current state.
 */
export async function provisionSiteHostname(
  siteId: string,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const pool = options.pool ?? defaultPool;
  const cfg = options.domainConfig ?? getDomainConfig();
  const steps: ProvisionStepResult[] = [];

  // ---- 1. Lookup -----------------------------------------------------
  // Construct Kinsta/Cloud Run clients AFTER the lookup so a missing-site
  // error surfaces before env-validation errors for the external clients.
  const siteRow = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM sites WHERE id = $1`,
    [siteId],
  );
  if (siteRow.rowCount === 0) {
    throw new Error(`site not found: ${siteId}`);
  }
  const slug = siteRow.rows[0].slug;
  const hostname = hostnameForSlug(slug, cfg);
  steps.push({ step: "lookup", status: "ok", detail: `slug=${slug} → ${hostname}` });

  const kinsta = options.kinsta ?? new KinstaClient();
  const cloudRun = options.cloudRun ?? new CloudRunDomainsClient();

  // ---- 2. site_domains row -------------------------------------------
  await pool.query(
    `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
     VALUES ($1, $2, true, 'pending', 'pending')
     ON CONFLICT (hostname) DO NOTHING`,
    [siteId, hostname],
  );
  evictSiteCache(hostname);
  steps.push({ step: "site_domains", status: "ok", detail: `upserted ${hostname}` });

  // ---- 3. Kinsta DNS --------------------------------------------------
  try {
    const domainId = await kinsta.getDomainIdByName(cfg.registrable);
    const records = await kinsta.listDnsRecords(domainId);
    const wantName = hostname.endsWith(".") ? hostname : `${hostname}.`;
    const existing = records.find(
      (r) => r.type === "CNAME" && r.name.toLowerCase() === wantName.toLowerCase(),
    );
    if (existing) {
      steps.push({
        step: "kinsta",
        status: "skipped",
        detail: `CNAME for ${hostname} already present in Kinsta zone`,
      });
    } else {
      const op = await kinsta.addCname(domainId, hostname, "ghs.googlehosted.com.");
      steps.push({
        step: "kinsta",
        status: "ok",
        detail: `CNAME ${hostname} → ghs.googlehosted.com. (kinsta op ${op.message})`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "kinsta", status: "error", detail: msg });
    return { site_id: siteId, slug, hostname, steps, ready: false };
  }

  // ---- 4. Cloud Run mapping ------------------------------------------
  let mapping: DomainMapping | undefined;
  try {
    mapping = await cloudRun.createIfMissing(hostname);
    steps.push({
      step: "cloud_run",
      status: "ok",
      detail: `mapping for ${hostname} present`,
      data: mapping,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "cloud_run", status: "error", detail: msg });
    return { site_id: siteId, slug, hostname, steps, ready: false };
  }

  // ---- 5. Optional wait for cert -------------------------------------
  let ready = false;
  if (options.wait) {
    try {
      const final = await cloudRun.waitForReady(hostname, {
        timeoutMs: options.waitTimeoutMs ?? 20 * 60 * 1000,
      });
      mapping = final;
      ready = true;
      steps.push({ step: "wait_ready", status: "ok", detail: "Ready + CertificateProvisioned" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ step: "wait_ready", status: "error", detail: msg });
    }
  }

  // Flip the site_domains row's verification/ssl status to reflect the
  // current Cloud Run mapping state if we waited.
  if (mapping) {
    const cReady = mapping.status?.conditions?.find((c) => c.type === "Ready")?.status === "True";
    const cCert = mapping.status?.conditions?.find((c) => c.type === "CertificateProvisioned")
      ?.status === "True";
    await pool.query(
      `UPDATE site_domains SET verification_status = $1, ssl_status = $2
        WHERE hostname = $3`,
      [cReady ? "verified" : "pending", cCert ? "active" : "pending", hostname],
    );
    evictSiteCache(hostname);
  }

  return { site_id: siteId, slug, hostname, steps, ready, cloud_run_mapping: mapping };
}
