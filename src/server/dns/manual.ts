/**
 * "Manual" / external DNS provider — the Wix-style "point your existing
 * domain" mode, and the honest fallback when we have no API access to a
 * domain. It never writes: the operator sets records at their registrar.
 * Verification is a live DNS lookup so status still works in the UI/CLI.
 */
import { Resolver } from "node:dns/promises";
import { type DnsProvider, type DnsRecord, type EnsureResult, normalizeData } from "./provider.js";

/** The subset of `node:dns/promises` Resolver we use — injectable for tests. */
export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
}

export class ManualDnsProvider implements DnsProvider {
  readonly id = "manual" as const;
  constructor(private readonly resolver: DnsResolver = new Resolver()) {}

  async ensureRecord(_zone: string, _record: DnsRecord): Promise<EnsureResult> {
    return "external"; // operator sets it at their registrar
  }

  async removeRecord(_zone: string, _record: DnsRecord): Promise<void> {
    // Nothing to remove; the record lives outside our control.
  }

  async verifyRecord(_zone: string, record: DnsRecord): Promise<boolean> {
    const host = record.name.replace(/\.+$/, "");
    const want = normalizeData(record.type, record.data);
    const type = record.type.toUpperCase();
    try {
      if (type === "CNAME") {
        const got = await this.resolver.resolveCname(host);
        return got.some((g) => normalizeData("CNAME", g) === want);
      }
      if (type === "A") {
        const got = await this.resolver.resolve4(host);
        return got.includes(want);
      }
      if (type === "TXT") {
        const got = await this.resolver.resolveTxt(host);
        return got.some((chunks) => chunks.join("") === want);
      }
      return false;
    } catch {
      return false;
    }
  }
}
