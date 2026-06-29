/**
 * Google Cloud DNS provider — interface-ready, NOT yet implemented. The
 * abstraction leaves the slot open so a Google-hosted managed zone can be
 * dropped in later (Wix-style "use our nameservers"). Until then every method
 * throws so misconfiguration fails loudly rather than silently no-op'ing.
 */
import { type DnsProvider, type EnsureResult } from "./provider.js";

const NOT_READY =
  "Cloud DNS provider is interface-ready but not yet implemented; set DNS_PROVIDER=godaddy or manual.";

export class CloudDnsProvider implements DnsProvider {
  readonly id = "cloud-dns" as const;
  async ensureRecord(): Promise<EnsureResult> {
    throw new Error(NOT_READY);
  }
  async verifyRecord(): Promise<boolean> {
    throw new Error(NOT_READY);
  }
  async removeRecord(): Promise<void> {
    throw new Error(NOT_READY);
  }
}
