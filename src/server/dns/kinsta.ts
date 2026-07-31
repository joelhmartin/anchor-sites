/**
 * Kinsta DNS provider. anchorcorps.com's zone lives on Kinsta DNS (Route 53
 * under the hood — GoDaddy has no zone file for it and 404s). Auth header is
 * `Authorization: Bearer <KEY>` — never logged.
 *
 * Verified against api-docs.kinsta.com/api-reference/domains/ (2026-07-30):
 *
 *   GET    /v2/domains?company={company_id}            → { company: { domains: [{ id, name, site_id, is_active }] } }
 *   GET    /v2/domains/{domain_id}/dns-records          → { domain: { dns_records: [{ type, name, ttl, resource_records: [{ value }] }] } }
 *   POST   /v2/domains/{domain_id}/dns-records          body { type, name, ttl (min 300), resource_records: [{ value }] }
 *   PUT    /v2/domains/{domain_id}/dns-records          body { type, name, ttl?, new_resource_records?, removed_resource_records? }
 *   DELETE /v2/domains/{domain_id}/dns-records          body { type, name }
 *
 * Every write returns 202 { operation_id, message, status } — Kinsta applies
 * it asynchronously. We treat "accepted" as success (the brief's call): the
 * only listing endpoint we have (dns-records) doesn't expose the operation's
 * terminal status, so polling it here would just be busy-waiting on a shape
 * we can't observe from the outside. Records show up in the next `list`.
 *
 * DNS records have no stable `id` in this API — a record is identified by
 * (type, name) only, so update/delete both address it that way too.
 *
 * Server creds come from `KINSTA_API_KEY` / `KINSTA_COMPANY_ID` in Secret
 * Manager → Cloud Run (KINSTA_COMPANY_ID maps to the `KINSTA_AGENCY_ID`
 * secret — same value, different name because that's what the Kinsta API
 * calls it).
 */
import {
  type DnsProvider,
  type DnsRecord,
  type EnsureResult,
  normalizeData,
} from "./provider.js";

export type KinstaConfig = { apiKey: string; companyId: string; baseUrl: string };

export function getKinstaConfig(env: NodeJS.ProcessEnv = process.env): KinstaConfig | null {
  const apiKey = env.KINSTA_API_KEY?.trim();
  const companyId = env.KINSTA_COMPANY_ID?.trim();
  if (!apiKey || !companyId) return null;
  const baseUrl = (env.KINSTA_API_BASE?.trim() || "https://api.kinsta.com/v2").replace(/\/+$/, "");
  return { apiKey, companyId, baseUrl };
}

type KinstaDomain = { id: string; name: string; site_id: string | null; is_active: boolean };
type KinstaDnsRecord = {
  type: string;
  name: string;
  ttl: number;
  resource_records: Array<{ value: string }>;
};

const stripDot = (s: string) => s.replace(/\.+$/, "");

/**
 * zone → domain_id resolution, cached per process (module scope, not
 * per-instance — `resolveDnsProvider()` may construct a fresh
 * `KinstaDnsProvider` on every call, and re-listing the company's domains on
 * every DNS operation would burn into the 120 req/min/company rate limit for
 * no reason; the mapping never changes without an operator action).
 * Keyed by baseUrl+companyId+zone so tests using distinct fake configs never
 * collide. A failed lookup is evicted so a later retry isn't poisoned by a
 * transient error.
 */
const domainIdCache = new Map<string, Promise<string>>();

/** Test-only escape hatch — DO NOT call from production code. */
export function __resetKinstaDomainCacheForTests(): void {
  domainIdCache.clear();
}

export class KinstaDnsProvider implements DnsProvider {
  readonly id = "kinsta" as const;
  constructor(private readonly cfg: KinstaConfig) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`Kinsta ${res.status} ${path}: ${detail}`);
    }
    return { status: res.status, body: body as T };
  }

  private cacheKey(zone: string): string {
    return `${this.cfg.baseUrl}|${this.cfg.companyId}|${stripDot(zone).toLowerCase()}`;
  }

  private async resolveDomainId(zone: string): Promise<string> {
    const key = this.cacheKey(zone);
    const cached = domainIdCache.get(key);
    if (cached) return cached;

    const lookup = (async () => {
      const { body } = await this.req<{ company?: { domains?: KinstaDomain[] } }>(
        `/domains?company=${encodeURIComponent(this.cfg.companyId)}`,
      );
      const domains = body.company?.domains ?? [];
      const wanted = stripDot(zone).toLowerCase();
      const match = domains.find((d) => stripDot(d.name).toLowerCase() === wanted);
      if (!match) {
        throw new Error(
          `Kinsta: no domain found for zone ${JSON.stringify(zone)} under company ${this.cfg.companyId}`,
        );
      }
      return match.id;
    })();
    domainIdCache.set(key, lookup);
    lookup.catch(() => domainIdCache.delete(key));
    return lookup;
  }

  private async listRecords(domainId: string): Promise<KinstaDnsRecord[]> {
    const { body } = await this.req<{ domain?: { dns_records?: KinstaDnsRecord[] } }>(
      `/domains/${encodeURIComponent(domainId)}/dns-records`,
    );
    return body.domain?.dns_records ?? [];
  }

  /**
   * Resolve `zone`'s domain_id and list its records, with ONE evict-and-retry
   * if the cached id turns out to be stale. The cache (above) never expires
   * on its own once a lookup succeeds (fix round 1, item 3) — if the Kinsta
   * domain entry is deleted and re-added on their side (new domain_id for
   * the same zone name), every subsequent call would 404 forever until this
   * process restarts. A 404 from `dns-records` for a domain_id that used to
   * be valid is exactly that signal, so we evict it and re-resolve once
   * before giving up. Returns the domainId actually used so callers write
   * against the right one, not the possibly-stale one they started with.
   */
  private async resolveAndListRecords(
    zone: string,
  ): Promise<{ domainId: string; records: KinstaDnsRecord[] }> {
    const domainId = await this.resolveDomainId(zone);
    try {
      return { domainId, records: await this.listRecords(domainId) };
    } catch (err) {
      if (!(err instanceof Error) || !/^Kinsta 404\b/.test(err.message)) throw err;
      domainIdCache.delete(this.cacheKey(zone));
      const freshId = await this.resolveDomainId(zone);
      return { domainId: freshId, records: await this.listRecords(freshId) };
    }
  }

  private findRecord(records: KinstaDnsRecord[], type: string, name: string): KinstaDnsRecord | undefined {
    const wantName = stripDot(name).toLowerCase();
    return records.find(
      (r) => r.type.toUpperCase() === type.toUpperCase() && stripDot(r.name).toLowerCase() === wantName,
    );
  }

  async ensureRecord(zone: string, record: DnsRecord): Promise<EnsureResult> {
    const type = record.type.toUpperCase();
    const name = stripDot(record.name);
    const data = normalizeData(record.type, record.data);

    const { domainId, records } = await this.resolveAndListRecords(zone);
    const existing = this.findRecord(records, type, name);

    if (!existing) {
      await this.req(`/domains/${encodeURIComponent(domainId)}/dns-records`, {
        method: "POST",
        body: JSON.stringify({
          type,
          name,
          ttl: Math.max(record.ttl ?? 3600, 300),
          resource_records: [{ value: data }],
        }),
      });
      return "created";
    }

    const hasValue = existing.resource_records.some((rr) => normalizeData(type, rr.value) === data);
    if (hasValue) return "exists";

    // D1003: converge on exactly the desired value. new_resource_records
    // alone APPENDS — leaving the stale value in place (an invalid
    // multi-value CNAME, with the stale target still served). Send the
    // stale values as removed_resource_records in the same PUT so the
    // record ends up holding only the target.
    const stale = existing.resource_records
      .filter((rr) => normalizeData(type, rr.value) !== data)
      .map((rr) => ({ value: rr.value }));
    await this.req(`/domains/${encodeURIComponent(domainId)}/dns-records`, {
      method: "PUT",
      body: JSON.stringify({
        type,
        name,
        new_resource_records: [{ value: data }],
        ...(stale.length > 0 ? { removed_resource_records: stale } : {}),
      }),
    });
    return "created";
  }

  async verifyRecord(zone: string, record: DnsRecord): Promise<boolean> {
    const type = record.type.toUpperCase();
    const data = normalizeData(record.type, record.data);
    const { records } = await this.resolveAndListRecords(zone);
    const existing = this.findRecord(records, type, record.name);
    if (!existing) return false;
    return existing.resource_records.some((rr) => normalizeData(type, rr.value) === data);
  }

  /**
   * Remove exactly the record we created (same law as GoDaddy's D1022):
   * Kinsta's DELETE addresses the whole (type, name) recordset, so with
   * co-resident values the target value is removed via PUT
   * `removed_resource_records` instead — and if the target value isn't in
   * the set at all, nothing is touched.
   */
  async removeRecord(zone: string, record: DnsRecord): Promise<void> {
    const type = record.type.toUpperCase();
    const name = stripDot(record.name);
    const data = normalizeData(record.type, record.data);
    const { domainId, records } = await this.resolveAndListRecords(zone);
    const existing = this.findRecord(records, type, name);
    if (!existing) return; // idempotent — nothing to remove

    const target = existing.resource_records.filter((rr) => normalizeData(type, rr.value) === data);
    if (target.length === 0) return; // target value absent — not ours to touch
    const remainder = existing.resource_records.length - target.length;

    if (remainder === 0) {
      await this.req(`/domains/${encodeURIComponent(domainId)}/dns-records`, {
        method: "DELETE",
        body: JSON.stringify({ type, name }),
      });
    } else {
      await this.req(`/domains/${encodeURIComponent(domainId)}/dns-records`, {
        method: "PUT",
        body: JSON.stringify({
          type,
          name,
          removed_resource_records: target.map((rr) => ({ value: rr.value })),
        }),
      });
    }
  }
}
