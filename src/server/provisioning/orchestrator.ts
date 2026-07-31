/**
 * Provision a tenant hostname end-to-end.
 *
 * Step order (each step is idempotent — re-running the orchestrator is
 * safe and useful when DNS or cert state is uncertain):
 *
 *   1. Resolve site by ID, compute canonical hostname `<slug>.<base>`.
 *   2. UPSERT `site_domains` row so the renderer can resolve the hostname
 *      via the explicit-domain path immediately.
 *   3. Cloud Run: createIfMissing the domain mapping for the hostname.
 *   4. DNS: read the records Cloud Run requires, then upsert each through
 *      the configured DnsProvider (GoDaddy / manual / cloud-dns). Idempotent.
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
import { resolveDnsProvider } from "../dns/resolve.js";
import type { DnsProvider, DnsRecord } from "../dns/provider.js";
import {
  CloudRunDomainsClient,
  type DomainMapping,
} from "../gcloud/run-domains.js";
import { applyDomainStatus, statusFromMappingConditions } from "../domains/status.js";
import { explainProvisionError } from "../domains/provision-error.js";

export type ProvisionStep = "lookup" | "site_domains" | "cloud_run" | "dns" | "wait_ready";

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
  dns?: DnsProvider;
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
  // Construct DNS/Cloud Run clients AFTER the lookup so a missing-site
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

  const dns = options.dns ?? resolveDnsProvider();
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

  // ---- 3. Cloud Run mapping ------------------------------------------
  // Created BEFORE DNS because the records we must set come FROM the mapping.
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
    // D609: the Webmaster-Central PermissionDenied is the known common
    // failure here — annotate the detail with the fix instruction, and
    // persist it onto the row (authoritative: this attempt genuinely ran
    // and genuinely failed) so the UI can render more than "failed".
    const msg = explainProvisionError(err instanceof Error ? err.message : String(err));
    steps.push({ step: "cloud_run", status: "error", detail: msg });
    await applyDomainStatus(
      pool,
      { hostname },
      { verification_status: "failed", ssl_status: "failed", error: msg },
      "authoritative",
    );
    evictSiteCache(hostname);
    return { site_id: siteId, slug, hostname, steps, ready: false };
  }

  // ---- 4. DNS records (provider-driven) ------------------------------
  try {
    const required =
      mapping.status?.resourceRecords && mapping.status.resourceRecords.length > 0
        ? mapping.status.resourceRecords
        : await cloudRun.getRequiredDnsRecords(hostname);

    if (required.length === 0) {
      steps.push({
        step: "dns",
        status: "skipped",
        detail: `Cloud Run reported no DNS records yet for ${hostname}`,
      });
    } else {
      const recs: DnsRecord[] = required.map((r) => ({
        name: r.name ?? hostname,
        type: (r.type ?? "CNAME").toUpperCase(),
        data: r.rrdata ?? "",
      }));
      const results = await Promise.all(
        recs.map((rec) => dns.ensureRecord(cfg.registrable, rec)),
      );
      const created = results.filter((x) => x === "created").length;
      const external = results.filter((x) => x === "external").length;
      const detail =
        external > 0
          ? `${dns.id}: ${external} record(s) to set manually — ${recs
              .map((r) => `${r.name} ${r.type} ${r.data}`)
              .join("; ")}`
          : `${dns.id}: ${created} created, ${results.length - created} already present`;
      steps.push({ step: "dns", status: created > 0 ? "ok" : "skipped", detail });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "dns", status: "error", detail: msg });
    await applyDomainStatus(
      pool,
      { hostname },
      { verification_status: "failed", ssl_status: "failed", error: `dns: ${msg}` },
      "authoritative",
    );
    evictSiteCache(hostname);
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
  // current Cloud Run mapping state. Authoritative (D608): a provision
  // attempt that got this far created/confirmed the mapping and wrote DNS —
  // real evidence, so even a previous 'failed' verdict is legitimately
  // walked back to the current truth (pending clears last_error too).
  if (mapping) {
    await applyDomainStatus(
      pool,
      { hostname },
      statusFromMappingConditions(mapping.status?.conditions),
      "authoritative",
    );
    evictSiteCache(hostname);
  }

  return { site_id: siteId, slug, hostname, steps, ready, cloud_run_mapping: mapping };
}
