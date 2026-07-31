/**
 * GoDaddy DNS provider. Reads/writes records via the GoDaddy v1 API
 * (`/v1/domains/{zone}/records/{type}/{name}`). Auth header is
 * `Authorization: sso-key <KEY>:<SECRET>` — never logged.
 *
 * Server creds come from `GODADDY_API_KEY` / `GODADDY_API_SECRET` in Secret
 * Manager → Cloud Run. The local `~/.claude/skills/godaddy/credentials.env`
 * file is for CLI use only and is never read here.
 */
import {
  type DnsProvider,
  type DnsRecord,
  type EnsureResult,
  relativeName,
  normalizeData,
} from "./provider.js";

export type GoDaddyConfig = { apiKey: string; apiSecret: string; baseUrl: string };

export function getGoDaddyConfig(env: NodeJS.ProcessEnv = process.env): GoDaddyConfig | null {
  const apiKey = env.GODADDY_API_KEY?.trim();
  const apiSecret = env.GODADDY_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  const baseUrl = (env.GODADDY_API_BASE?.trim() || "https://api.godaddy.com").replace(/\/+$/, "");
  return { apiKey, apiSecret, baseUrl };
}

type GoDaddyRecord = { data: string; name?: string; type?: string; ttl?: number };

export class GoDaddyDnsProvider implements DnsProvider {
  readonly id = "godaddy" as const;
  constructor(private readonly cfg: GoDaddyConfig) {}

  private async req(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `sso-key ${this.cfg.apiKey}:${this.cfg.apiSecret}`,
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
    // D1001: 404 is a normal "no such record" answer ONLY for reads. For a
    // write (PUT/DELETE), a 404 means GoDaddy rejected it — e.g. the zone
    // isn't hosted here at all (UNKNOWN_DOMAIN: the documented
    // anchorcorps.com case, whose zone lives on Kinsta DNS). The old
    // behavior reported "created"/silent success with zero records written.
    const method = (init.method ?? "GET").toUpperCase();
    const benign404 = res.status === 404 && method === "GET";
    if (!res.ok && !benign404) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`GoDaddy ${res.status} ${path}: ${detail}`);
    }
    return { status: res.status, body };
  }

  private async getRecords(zone: string, type: string, name: string): Promise<GoDaddyRecord[]> {
    const { status, body } = await this.req(
      `/v1/domains/${encodeURIComponent(zone)}/records/${type}/${encodeURIComponent(name)}`,
    );
    if (status === 404 || !Array.isArray(body)) return [];
    return body as GoDaddyRecord[];
  }

  async ensureRecord(zone: string, record: DnsRecord): Promise<EnsureResult> {
    const name = relativeName(record.name, zone);
    const data = normalizeData(record.type, record.data);
    const existing = await this.getRecords(zone, record.type, name);
    if (existing.some((r) => normalizeData(record.type, r.data) === data)) return "exists";
    await this.req(
      `/v1/domains/${encodeURIComponent(zone)}/records/${record.type}/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify([{ data, ttl: record.ttl ?? 3600 }]) },
    );
    return "created";
  }

  async verifyRecord(zone: string, record: DnsRecord): Promise<boolean> {
    const name = relativeName(record.name, zone);
    const data = normalizeData(record.type, record.data);
    const existing = await this.getRecords(zone, record.type, name);
    return existing.some((r) => normalizeData(record.type, r.data) === data);
  }

  /**
   * D1022: remove exactly the record we created. GoDaddy's DELETE at
   * `/records/{type}/{name}` drops the ENTIRE recordset at that name/type
   * regardless of value — destroying any co-resident record (e.g. multiple
   * A values). GoDaddy has no per-value delete, so: read the set, filter
   * out the target value, PUT the remainder — and only when the target was
   * the sole value is the whole-set DELETE issued.
   */
  async removeRecord(zone: string, record: DnsRecord): Promise<void> {
    const name = relativeName(record.name, zone);
    const data = normalizeData(record.type, record.data);
    const path = `/v1/domains/${encodeURIComponent(zone)}/records/${record.type}/${encodeURIComponent(name)}`;

    const existing = await this.getRecords(zone, record.type, name);
    if (existing.length === 0) return; // nothing at name/type — idempotent
    const remainder = existing.filter((r) => normalizeData(record.type, r.data) !== data);
    if (remainder.length === existing.length) return; // target value absent — not ours to touch

    if (remainder.length === 0) {
      await this.req(path, { method: "DELETE" });
    } else {
      await this.req(path, {
        method: "PUT",
        body: JSON.stringify(remainder.map((r) => ({ data: r.data, ttl: r.ttl ?? 3600 }))),
      });
    }
  }
}
