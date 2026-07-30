/**
 * DNS provider abstraction. The provisioning orchestrator writes the records
 * Cloud Run requires through whichever provider the environment selects
 * (GoDaddy API today; Cloud DNS later; "manual" when we have no API access).
 * Mirrors the env-driven mode switch in `studio-auth.ts` / `ai/config.ts`.
 */

export type DnsProviderId = "godaddy" | "kinsta" | "cloud-dns" | "manual";

/** A single DNS record in absolute (FQDN) terms. `data` is the value
 *  (CNAME target, A address, TXT string). */
export type DnsRecord = { name: string; type: string; data: string; ttl?: number };

/** Result of an idempotent upsert: we wrote it, it was already there, or the
 *  provider does not write (operator sets it at their registrar). */
export type EnsureResult = "created" | "exists" | "external";

export interface DnsProvider {
  readonly id: DnsProviderId;
  /** Idempotent upsert of one record into `zone` (the registrable apex). */
  ensureRecord(zone: string, record: DnsRecord): Promise<EnsureResult>;
  /** True if the record is currently present/resolvable — for verification. */
  verifyRecord(zone: string, record: DnsRecord): Promise<boolean>;
  /** Remove the record (unprovision / cleanup). */
  removeRecord(zone: string, record: DnsRecord): Promise<void>;
}

/** `muldoon.sites.anchorcorps.com` in zone `anchorcorps.com` → `muldoon.sites`.
 *  The apex itself → `@`. Tolerates trailing dots and mixed case. */
export function relativeName(fqdn: string, zone: string): string {
  const f = fqdn.replace(/\.+$/, "").toLowerCase();
  const z = zone.replace(/\.+$/, "").toLowerCase();
  if (f === z) return "@";
  if (f.endsWith(`.${z}`)) return f.slice(0, f.length - z.length - 1);
  throw new Error(`relativeName: ${JSON.stringify(fqdn)} is not within zone ${JSON.stringify(zone)}`);
}

/** Inverse of `relativeName`. `@` → the apex. */
export function toFqdn(name: string, zone: string): string {
  const z = zone.replace(/\.+$/, "").toLowerCase();
  if (name === "@" || name === "") return z;
  return `${name.replace(/\.+$/, "").toLowerCase()}.${z}`;
}

/** Normalize a record value for comparison. CNAME targets are
 *  case-insensitive and trailing-dot-insensitive; everything else is trimmed. */
export function normalizeData(type: string, data: string): string {
  const d = data.trim();
  return type.toUpperCase() === "CNAME" ? d.replace(/\.+$/, "").toLowerCase() : d;
}
