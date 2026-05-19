/**
 * Typed Kinsta v2 API client — just the surface the provisioning workflow
 * needs (domain lookup + DNS record CRUD).
 *
 * Auth: Bearer token via `KINSTA_API_KEY`. Most listing endpoints require
 * the company UUID via the `company` query param; the secret name on the
 * GCP side is `KINSTA_AGENCY_ID` (Kinsta uses "agency" and "company"
 * interchangeably — same UUID in v2).
 *
 * Two important gotchas codified here:
 *
 *   1. `POST /v2/domains/{id}/dns-records` accepts `name` as a fully-
 *      qualified hostname only. Passing a relative label (e.g.
 *      `muldoon.sites`) returns `RRSet ... is not permitted in zone ...`.
 *      We always pass the FQDN.
 *
 *   2. Writes return `{operation_id}` with status 202; the actual work is
 *      async. `poll()` waits for terminal status, surfacing the error
 *      payload Kinsta puts under `data.message`.
 */

const DEFAULT_BASE = "https://api.kinsta.com/v2";

export type KinstaConfig = {
  apiKey: string;
  companyId: string;
  baseUrl?: string;
};

export function getKinstaConfig(): KinstaConfig {
  const apiKey = process.env.KINSTA_API_KEY;
  const companyId = process.env.KINSTA_AGENCY_ID ?? process.env.KINSTA_COMPANY_ID;
  if (!apiKey) throw new Error("KINSTA_API_KEY is not set");
  if (!companyId) throw new Error("KINSTA_AGENCY_ID (or KINSTA_COMPANY_ID) is not set");
  return { apiKey, companyId };
}

// ---------- types ----------

export type CompanyDomain = {
  id: string;
  name: string;
  site_id: string | null;
  is_active: boolean;
};

export type DnsRecord = {
  type: string;
  name: string;
  ttl: number;
  resource_records: { value: string }[];
};

export type CreateDnsRecordInput = {
  /** Fully-qualified name. Relative labels are rejected by Kinsta. */
  name: string;
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS";
  ttl?: number;
  resource_records: { value: string }[];
};

type AsyncOperationReply = {
  status: number;
  message: string;
  operation_id: string;
};

type OperationStatus = {
  status: number;
  message: string;
  data?: { result?: unknown; status?: number; message?: string };
};

// ---------- client ----------

export class KinstaClient {
  readonly apiKey: string;
  readonly companyId: string;
  readonly baseUrl: string;

  constructor(cfg: KinstaConfig = getKinstaConfig()) {
    this.apiKey = cfg.apiKey;
    this.companyId = cfg.companyId;
    this.baseUrl = cfg.baseUrl ?? DEFAULT_BASE;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`kinsta ${res.status} ${path}: ${text}`);
    }
    return body as T;
  }

  // List all domains the company has registered. Used to look up the zone
  // ID for a given registrable name.
  async listDomains(): Promise<CompanyDomain[]> {
    const body = await this.req<{ company: { domains: CompanyDomain[] } }>(
      `/domains?company=${encodeURIComponent(this.companyId)}`,
    );
    return body.company?.domains ?? [];
  }

  async getDomainIdByName(registrable: string): Promise<string> {
    const list = await this.listDomains();
    const target = registrable.toLowerCase();
    const match = list.find((d) => d.name.toLowerCase() === target);
    if (!match) {
      throw new Error(
        `no Kinsta domain matches ${JSON.stringify(registrable)}; the zone must be registered in Kinsta first`,
      );
    }
    return match.id;
  }

  async listDnsRecords(domainId: string): Promise<DnsRecord[]> {
    const body = await this.req<{ domain: { dns_records: DnsRecord[] } }>(
      `/domains/${domainId}/dns-records`,
    );
    return body.domain?.dns_records ?? [];
  }

  /**
   * Create a DNS record. Returns the Kinsta operation ID — callers must
   * await `poll(opId)` to know whether it actually succeeded.
   */
  async createDnsRecord(domainId: string, input: CreateDnsRecordInput): Promise<string> {
    // Catch the most common mistake up front rather than waiting for
    // Kinsta's misleading "RRSet not permitted in zone" error. Kinsta's
    // zones are at the registrable level (one dot); any record inside a
    // zone must have at least two dots in its FQDN.
    if ((input.name.match(/\./g) ?? []).length < 2) {
      throw new Error(
        `Kinsta DNS create requires a FQDN inside the zone; got ${JSON.stringify(input.name)}`,
      );
    }
    const body = await this.req<AsyncOperationReply>(
      `/domains/${domainId}/dns-records`,
      {
        method: "POST",
        body: JSON.stringify({
          type: input.type,
          name: input.name,
          ttl: input.ttl ?? 3600,
          resource_records: input.resource_records,
        }),
      },
    );
    return body.operation_id;
  }

  async getOperation(operationId: string): Promise<OperationStatus> {
    return this.req<OperationStatus>(`/operations/${encodeURIComponent(operationId)}`);
  }

  /**
   * Poll an operation until it reaches a terminal status. Throws if the
   * operation reports failure or the timeout elapses.
   */
  async pollOperation(
    operationId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<OperationStatus> {
    const timeout = opts.timeoutMs ?? 30_000;
    const interval = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeout;
    let lastStatus: OperationStatus | undefined;
    while (Date.now() < deadline) {
      const op = await this.getOperation(operationId);
      lastStatus = op;
      // Terminal: 200 ok or non-2xx anything-else.
      if (op.status >= 200 && op.status < 300 && !op.message.toLowerCase().includes("in progress")) {
        return op;
      }
      if (op.status >= 400) {
        const detail = op.data?.message ?? op.message;
        throw new Error(`kinsta operation ${operationId} failed: ${detail}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(
      `kinsta operation ${operationId} did not complete within ${timeout}ms (last: ${lastStatus?.message})`,
    );
  }

  /**
   * Convenience: create a CNAME and wait for success. Returns the operation
   * payload once Kinsta confirms.
   */
  async addCname(
    domainId: string,
    name: string,
    target: string,
    opts: { ttl?: number; pollMs?: number } = {},
  ): Promise<OperationStatus> {
    const opId = await this.createDnsRecord(domainId, {
      name,
      type: "CNAME",
      ttl: opts.ttl ?? 3600,
      resource_records: [{ value: target.endsWith(".") ? target : `${target}.` }],
    });
    return this.pollOperation(opId, { timeoutMs: opts.pollMs ?? 30_000 });
  }
}
