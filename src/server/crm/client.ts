/**
 * P11-T11.6 (D-053) — CRM HTTP client for anchor-hub.
 *
 * Interfaces + three implementations:
 *   HttpCrmClient  — real HTTP calls with Bearer auth.
 *   StubCrmClient  — log-only, returns empty data (dev / missing credentials).
 *   NullCrmClient  — silent no-op (CRM_DISABLED=true or opt-out per install).
 *
 * Injectable `fetch` for tests (same pattern as GoDaddyDnsProvider).
 */

export type CrmPhoneNumber = {
  id: string;
  number: string;
  display: string;
  trackingType?: string;
};

export type CrmCampaign = {
  id: string;
  name: string;
  status: string;
};

export type CrmSiteProvisionResult = {
  crmSiteId: string;
};

export interface CrmClient {
  /** POST /sites — provision a site in anchor-hub, returns the CRM site ID. */
  provisionSite(
    siteId: string,
    name: string,
    primaryDomain: string,
  ): Promise<CrmSiteProvisionResult>;

  /** PATCH /sites/:id — update site name / primary domain. */
  updateSite(
    crmSiteId: string,
    patch: { name?: string; primaryDomain?: string },
  ): Promise<void>;

  /** DELETE /sites/:id — deprovision a site. */
  deprovisionSite(crmSiteId: string): Promise<void>;

  /** GET /sites/:id/phone-numbers */
  listPhoneNumbers(crmSiteId: string): Promise<CrmPhoneNumber[]>;

  /** GET /sites/:id/campaigns */
  listCampaigns(crmSiteId: string): Promise<CrmCampaign[]>;
}

// ---------------------------------------------------------------------------
// HttpCrmClient
// ---------------------------------------------------------------------------

/**
 * Default per-request ceiling for every CRM call.
 *
 * FINAL whole-branch review, FIX-NOW item 4: `request()` had NO timeout at
 * all. `createSiteWithDomains` calls `provisionSite` from inside the open
 * site-creation transaction, so an unresponsive anchor-hub held a Postgres
 * transaction (and a pooled connection, and the operator's HTTP request)
 * open for as long as the platform's socket timeout allowed — well past
 * Cloud Run's own 60s request budget. 10s is generous for a JSON control-
 * plane call and still leaves room for the rest of site creation.
 */
export const CRM_REQUEST_TIMEOUT_MS = 10_000;

export class HttpCrmClient implements CrmClient {
  private baseUrl: string;
  private apiKey: string;
  private fetch: typeof globalThis.fetch;
  private timeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    /** Override the per-request timeout. Tests only — production uses the
     *  `CRM_REQUEST_TIMEOUT_MS` default. */
    timeoutMs?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? CRM_REQUEST_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // `AbortSignal.timeout` rejects the fetch with a DOMException named
    // "TimeoutError" (Node ≥18); an explicitly aborted request surfaces as
    // "AbortError". Both are re-thrown as a plain Error whose message names
    // the CRM, the call, and the budget — the caller (create-site.ts,
    // sync-job.ts) only ever logs it, so an opaque "The operation was
    // aborted" would have been useless in a production log.
    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(
          `CRM ${method} ${path} timed out after ${this.timeoutMs}ms (anchor-hub unreachable or slow)`,
        );
      }
      throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`CRM ${method} ${path} → ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async provisionSite(
    siteId: string,
    name: string,
    primaryDomain: string,
  ): Promise<CrmSiteProvisionResult> {
    const data = await this.request<{ id: string }>("POST", "/sites", {
      siteId,
      name,
      primaryDomain,
    });
    return { crmSiteId: data.id };
  }

  async updateSite(
    crmSiteId: string,
    patch: { name?: string; primaryDomain?: string },
  ): Promise<void> {
    await this.request("PATCH", `/sites/${crmSiteId}`, patch);
  }

  async deprovisionSite(crmSiteId: string): Promise<void> {
    await this.request("DELETE", `/sites/${crmSiteId}`);
  }

  async listPhoneNumbers(crmSiteId: string): Promise<CrmPhoneNumber[]> {
    return this.request<CrmPhoneNumber[]>("GET", `/sites/${crmSiteId}/phone-numbers`);
  }

  async listCampaigns(crmSiteId: string): Promise<CrmCampaign[]> {
    return this.request<CrmCampaign[]>("GET", `/sites/${crmSiteId}/campaigns`);
  }
}

// ---------------------------------------------------------------------------
// StubCrmClient — dev / no credentials
// ---------------------------------------------------------------------------

export class StubCrmClient implements CrmClient {
  private log(msg: string): void {
    // eslint-disable-next-line no-console
    console.log(`[CRM stub] ${msg}`);
  }

  async provisionSite(siteId: string, name: string, _primaryDomain: string): Promise<CrmSiteProvisionResult> {
    this.log(`provisionSite(${siteId}, "${name}") — stub`);
    return { crmSiteId: `stub-${siteId}` };
  }

  async updateSite(crmSiteId: string, patch: object): Promise<void> {
    this.log(`updateSite(${crmSiteId}, ${JSON.stringify(patch)}) — stub`);
  }

  async deprovisionSite(crmSiteId: string): Promise<void> {
    this.log(`deprovisionSite(${crmSiteId}) — stub`);
  }

  async listPhoneNumbers(_crmSiteId: string): Promise<CrmPhoneNumber[]> {
    return [];
  }

  async listCampaigns(_crmSiteId: string): Promise<CrmCampaign[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// NullCrmClient — CRM_DISABLED=true (silent no-op)
// ---------------------------------------------------------------------------

export class NullCrmClient implements CrmClient {
  async provisionSite(_siteId: string, _name: string, _primaryDomain: string): Promise<CrmSiteProvisionResult> {
    return { crmSiteId: "" };
  }
  async updateSite(_crmSiteId: string, _patch: { name?: string; primaryDomain?: string }): Promise<void> {}
  async deprovisionSite(_crmSiteId: string): Promise<void> {}
  async listPhoneNumbers(_crmSiteId: string): Promise<CrmPhoneNumber[]> {
    return [];
  }
  async listCampaigns(_crmSiteId: string): Promise<CrmCampaign[]> {
    return [];
  }
}
