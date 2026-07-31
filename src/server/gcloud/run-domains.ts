/**
 * Cloud Run domain mapping client — REST against the regional endpoint, so
 * the same code works from a Cloud Run container (using the metadata-server
 * token) and from local dev (using gcloud's local session).
 *
 * Cloud Run's domain-mapping resource is exposed by the regional Knative API:
 *
 *   https://{region}-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/{project_id}/domainmappings
 *
 * The runtime / operator service account needs `roles/run.admin` (or a
 * narrower equivalent that includes `run.domainmappings.create` +
 * `run.domainmappings.get`) on the project.
 */

import { getGcpAccessToken } from "./access-token.js";

export type GcloudConfig = {
  projectId: string;
  region: string;
  /** Cloud Run service name to bind subdomains to. */
  serviceName: string;
};

export function getGcloudConfig(): GcloudConfig {
  const projectId = process.env.GCP_PROJECT_ID;
  const region = process.env.GCP_REGION ?? "us-central1";
  const serviceName = process.env.GCP_RUN_SERVICE ?? "anchor-sites";
  if (!projectId) throw new Error("GCP_PROJECT_ID is not set");
  return { projectId, region, serviceName };
}

export type DomainMappingStatus = {
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  resourceRecords?: Array<{ name?: string; type?: string; rrdata?: string }>;
  url?: string;
};

export type DomainMapping = {
  apiVersion: "domains.cloudrun.com/v1";
  kind: "DomainMapping";
  metadata: { name: string; namespace: string; labels?: Record<string, string> };
  spec: { routeName: string; certificateMode?: "AUTOMATIC" | "NONE" };
  status?: DomainMappingStatus;
};

export class CloudRunDomainsClient {
  readonly cfg: GcloudConfig;

  constructor(cfg: GcloudConfig = getGcloudConfig()) {
    this.cfg = cfg;
  }

  private baseUrl(): string {
    return `https://${this.cfg.region}-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/${this.cfg.projectId}/domainmappings`;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getGcpAccessToken();
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Cloud Run ${res.status} ${path || "/"}: ${text}`);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  async get(hostname: string): Promise<DomainMapping | null> {
    try {
      return await this.req<DomainMapping>(`/${encodeURIComponent(hostname)}`);
    } catch (err) {
      if (err instanceof Error && /\b404\b/.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * D1024: `labels` (e.g. `{ site_id }`) are stamped onto the mapping's
   * metadata so every per-tenant cloud resource is attributable and the
   * reconcile pass (provisioning/reconcile.ts) can detect orphans.
   */
  async create(
    hostname: string,
    opts: { labels?: Record<string, string> } = {},
  ): Promise<DomainMapping> {
    const body: DomainMapping = {
      apiVersion: "domains.cloudrun.com/v1",
      kind: "DomainMapping",
      metadata: {
        name: hostname,
        namespace: this.cfg.projectId,
        ...(opts.labels ? { labels: opts.labels } : {}),
      },
      spec: { routeName: this.cfg.serviceName, certificateMode: "AUTOMATIC" },
    };
    return this.req<DomainMapping>("", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async createIfMissing(
    hostname: string,
    opts: { labels?: Record<string, string> } = {},
  ): Promise<DomainMapping> {
    const existing = await this.get(hostname);
    if (existing) return existing;
    return this.create(hostname, opts);
  }

  /**
   * List every domain mapping in the project/region (D1024 reconcile —
   * list-and-compare against `site_domains` to surface orphans).
   */
  async list(): Promise<DomainMapping[]> {
    const body = await this.req<{ items?: DomainMapping[] }>("");
    return body.items ?? [];
  }

  /**
   * Poll a mapping until `Ready` and `CertificateProvisioned` are both `True`.
   * Returns the final mapping. Throws on timeout.
   */
  async waitForReady(
    hostname: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<DomainMapping> {
    const timeout = opts.timeoutMs ?? 20 * 60 * 1000; // 20 min — cert issuance can be slow
    const interval = opts.intervalMs ?? 15_000;
    const deadline = Date.now() + timeout;

    let last: DomainMapping | null = null;
    while (Date.now() < deadline) {
      last = await this.get(hostname);
      if (last?.status?.conditions) {
        const ready = last.status.conditions.find((c) => c.type === "Ready");
        const cert = last.status.conditions.find((c) => c.type === "CertificateProvisioned");
        if (ready?.status === "True" && cert?.status === "True") {
          return last;
        }
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    const summary = last?.status?.conditions
      ?.map((c) => `${c.type}=${c.status}`)
      .join(", ");
    throw new Error(
      `Cloud Run domain mapping ${hostname} not ready after ${timeout}ms (last: ${summary ?? "no status"})`,
    );
  }

  /**
   * Return the DNS records Cloud Run says the operator must add for this
   * mapping. Useful for surfacing the CNAME target to the admin UI / CLI
   * even before Cloud Run has the mapping fully wired.
   */
  async getRequiredDnsRecords(hostname: string): Promise<NonNullable<DomainMappingStatus["resourceRecords"]>> {
    const m = await this.get(hostname);
    return m?.status?.resourceRecords ?? [];
  }

  async deleteMapping(hostname: string): Promise<void> {
    await this.req(`/${encodeURIComponent(hostname)}`, { method: "DELETE" });
  }
}
