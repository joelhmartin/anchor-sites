import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { evictSiteCache } from "../../middleware/resolveSite.js";
import { getDomainConfig, isUnderSitesDomain } from "../../config/domain.js";
import { resolveDnsProvider } from "../dns/resolve.js";
import type { DnsProvider } from "../dns/provider.js";
import { ManualDnsProvider } from "../dns/manual.js";
import { CloudRunDomainsClient } from "../gcloud/run-domains.js";
import { applyDomainStatus, statusFromMappingConditions } from "../domains/status.js";
import { explainProvisionError } from "../domains/provision-error.js";

/** Classify a hostname as managed (our DNS) or client-owned (external DNS). */
function domainClass(hostname: string): "managed" | "client-owned" {
  return isUnderSitesDomain(hostname) ? "managed" : "client-owned";
}

const HOSTNAME_RE =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const addDomainPayload = z.object({
  hostname: z
    .string()
    .min(1)
    .max(253)
    .refine((h) => !h.startsWith("*"), { message: "wildcard hostnames are not allowed" })
    .refine((h) => HOSTNAME_RE.test(h), { message: "invalid hostname format" }),
});

export type AdminDomainsOptions = {
  pool?: Pool;
  dns?: DnsProvider;
  cloudRun?: CloudRunDomainsClient;
};

type DomainRow = {
  id: string;
  site_id: string;
  hostname: string;
  is_primary: boolean;
  verification_status: string;
  ssl_status: string;
  /** D609: why the row is 'failed' (annotated with the Webmaster-Central
   *  instruction when that's the cause). Null unless failed. */
  last_error: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  domain_class: "managed" | "client-owned";
};

const DOMAIN_COLUMNS = `id, site_id, hostname, is_primary, verification_status, ssl_status,
       last_error, created_at, updated_at, verified_at`;

function toDomainRow(row: Omit<DomainRow, "domain_class">): DomainRow {
  return { ...row, domain_class: domainClass(row.hostname) };
}

export function adminDomainsRouter(opts: AdminDomainsOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();

  // Lazy-resolve Cloud Run / DNS clients so tests can inject mocks
  function getCloudRun() {
    return opts.cloudRun ?? new CloudRunDomainsClient();
  }
  function getDns() {
    return opts.dns ?? resolveDnsProvider();
  }

  // GET /api/sites/:siteId/domains — list domains with status + class.
  router.get(
    "/sites/:siteId/domains",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const result = await pool.query<Omit<DomainRow, "domain_class">>(
          `SELECT ${DOMAIN_COLUMNS}
             FROM site_domains
            WHERE site_id = $1
            ORDER BY is_primary DESC, created_at ASC`,
          [siteId],
        );
        res.json({ domains: result.rows.map(toDomainRow) });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/sites/:siteId/domains — add a hostname to a site.
  router.post(
    "/sites/:siteId/domains",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = addDomainPayload.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid payload",
          details: parsed.error.errors.map((e) => ({
            path: e.path.join(".") || "(root)",
            message: e.message,
          })),
        });
        return;
      }
      const { siteId } = req.params;
      const { hostname } = parsed.data;
      try {
        const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
        if (siteOk.rowCount === 0) {
          res.status(404).json({ error: "site not found" });
          return;
        }

        const ins = await pool.query<Omit<DomainRow, "domain_class">>(
          `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
           VALUES ($1, $2, false, 'pending', 'pending')
           RETURNING ${DOMAIN_COLUMNS}`,
          [siteId, hostname.toLowerCase()],
        );
        res.status(201).json({ domain: toDomainRow(ins.rows[0]) });
      } catch (err: unknown) {
        const pg = err as { code?: string };
        if (pg.code === "23505") {
          res.status(409).json({ error: "hostname already in use" });
          return;
        }
        next(err);
      }
    },
  );

  // DELETE /api/sites/:siteId/domains/:domainId — remove + unprovision.
  router.delete(
    "/sites/:siteId/domains/:domainId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, domainId } = req.params;
        const row = await pool.query<{ hostname: string; is_primary: boolean }>(
          `SELECT hostname, is_primary FROM site_domains WHERE id = $1 AND site_id = $2`,
          [domainId, siteId],
        );
        if (row.rowCount === 0) {
          res.status(404).json({ error: "domain not found" });
          return;
        }
        const { hostname, is_primary } = row.rows[0];
        if (is_primary) {
          res.status(400).json({ error: "cannot remove the primary domain" });
          return;
        }

        // Best-effort unprovision: remove Cloud Run mapping and DNS record.
        const cloudRun = getCloudRun();
        const dns = getDns();
        const cfg = getDomainConfig();

        await cloudRun.deleteMapping(hostname).catch(() => undefined);

        // Ask Cloud Run what records were set; remove them from DNS.
        // Fall back to a CNAME record guess if Cloud Run has no info.
        try {
          const records = await cloudRun.getRequiredDnsRecords(hostname).catch(() => []);
          for (const rec of records) {
            await dns
              .removeRecord(cfg.registrable, {
                name: rec.name ?? hostname,
                type: (rec.type ?? "CNAME").toUpperCase(),
                data: rec.rrdata ?? "",
              })
              .catch(() => undefined);
          }
        } catch {
          // DNS removal is best-effort; never block delete.
        }

        await pool.query(`DELETE FROM site_domains WHERE id = $1`, [domainId]);
        evictSiteCache(hostname);

        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/sites/:siteId/domains/:domainId/provision — trigger Cloud Run + DNS.
  router.post(
    "/sites/:siteId/domains/:domainId/provision",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, domainId } = req.params;
        const row = await pool.query<{ hostname: string }>(
          `SELECT hostname FROM site_domains WHERE id = $1 AND site_id = $2`,
          [domainId, siteId],
        );
        if (row.rowCount === 0) {
          res.status(404).json({ error: "domain not found" });
          return;
        }
        const { hostname } = row.rows[0];
        const cfg = getDomainConfig();
        const cloudRun = getCloudRun();
        // Client-owned domains (outside the Anchor zone) must use ManualDnsProvider:
        // their records are surfaced to the operator rather than auto-written via GoDaddy.
        const dns =
          opts.dns ?? (domainClass(hostname) === "managed" ? resolveDnsProvider() : new ManualDnsProvider());

        // Step 1: Cloud Run mapping
        let mapping;
        try {
          mapping = await cloudRun.createIfMissing(hostname);
        } catch (err) {
          // D609: annotate the known Webmaster-Central PermissionDenied with
          // its fix instruction, and persist it (authoritative failed) so the
          // failure survives a page reload — not just this response body.
          const detail = explainProvisionError(err instanceof Error ? err.message : String(err));
          await applyDomainStatus(
            pool,
            { id: domainId },
            { verification_status: "failed", ssl_status: "failed", error: detail },
            "authoritative",
          );
          evictSiteCache(hostname);
          res.json({
            steps: [{ step: "cloud_run", status: "error", detail }],
            required_records: [],
          });
          return;
        }

        const steps: Array<{ step: string; status: string; detail?: string }> = [
          { step: "cloud_run", status: "ok", detail: `mapping for ${hostname} present` },
        ];

        // Step 2: DNS records
        const resourceRecords =
          mapping.status?.resourceRecords && mapping.status.resourceRecords.length > 0
            ? mapping.status.resourceRecords
            : await cloudRun.getRequiredDnsRecords(hostname).catch(() => []);

        const requiredRecords = resourceRecords.map((r) => ({
          name: r.name ?? hostname,
          type: (r.type ?? "CNAME").toUpperCase(),
          data: r.rrdata ?? "",
        }));

        if (requiredRecords.length === 0) {
          steps.push({
            step: "dns",
            status: "skipped",
            detail: "Cloud Run has not produced DNS records yet",
          });
        } else {
          try {
            const results = await Promise.all(
              requiredRecords.map((rec) => dns.ensureRecord(cfg.registrable, rec)),
            );
            const created = results.filter((x) => x === "created").length;
            const external = results.filter((x) => x === "external").length;
            steps.push({
              step: "dns",
              status: "ok",
              detail:
                external > 0
                  ? `${external} record(s) require manual DNS configuration`
                  : `${created} created, ${results.length - created} already present`,
            });
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            steps.push({ step: "dns", status: "error", detail });
          }
        }

        // Update site_domains status through the D608 transition helper.
        // Authoritative: this attempt really ran against Cloud Run/DNS.
        // A DNS step error is a genuine failure (persist it as such, with
        // the detail — D609); otherwise project the mapping conditions.
        const dnsError = steps.find((s) => s.step === "dns" && s.status === "error");
        if (dnsError) {
          await applyDomainStatus(
            pool,
            { id: domainId },
            { verification_status: "failed", ssl_status: "failed", error: `dns: ${dnsError.detail}` },
            "authoritative",
          );
        } else {
          await applyDomainStatus(
            pool,
            { id: domainId },
            statusFromMappingConditions(mapping.status?.conditions),
            "authoritative",
          );
        }
        evictSiteCache(hostname);

        res.json({ steps, required_records: requiredRecords });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/domains/:domainId/status — poll Cloud Run → update DB.
  router.get(
    "/sites/:siteId/domains/:domainId/status",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, domainId } = req.params;
        const row = await pool.query<Omit<DomainRow, "domain_class">>(
          `SELECT ${DOMAIN_COLUMNS}
             FROM site_domains
            WHERE id = $1 AND site_id = $2`,
          [domainId, siteId],
        );
        if (row.rowCount === 0) {
          res.status(404).json({ error: "domain not found" });
          return;
        }
        const domain = row.rows[0];

        // Best-effort Cloud Run poll — if it fails just return current DB state.
        // D608: this is a PASSIVE observation, so the write is upgrade-only —
        // it may move pending→verified/active but must never rewrite a
        // terminal 'failed' back to 'pending' (that erased an exhausted-retry
        // verdict, and its last_error, the moment anyone opened the Domains
        // tab). A real re-check that CAN walk back 'failed' is the explicit
        // POST …/verify route.
        try {
          const cloudRun = getCloudRun();
          const mapping = await cloudRun.get(domain.hostname);
          if (mapping?.status?.conditions) {
            const updated = await applyDomainStatus(
              pool,
              { id: domainId },
              statusFromMappingConditions(mapping.status.conditions),
              "upgrade-only",
            );
            if (updated) {
              domain.verification_status = updated.verification_status;
              domain.ssl_status = updated.ssl_status;
              domain.last_error = updated.last_error;
              domain.updated_at = updated.updated_at;
              domain.verified_at = updated.verified_at;
            }
            evictSiteCache(domain.hostname);
          }
        } catch {
          // Graceful degradation — return DB state if Cloud Run is unreachable.
        }

        res.json({ domain: toDomainRow(domain) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
