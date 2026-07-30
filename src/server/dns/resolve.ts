/**
 * Pick the DNS provider from the environment, mirroring
 * `resolveStudioAuthMode`. Default precedence when `DNS_PROVIDER` is unset:
 * Kinsta (when its creds are present) > GoDaddy (when its creds are present)
 * > manual (graceful degradation — never crash for missing creds). Kinsta
 * wins the default over GoDaddy because anchorcorps.com's primary zone lives
 * on Kinsta DNS — GoDaddy has no zone file for it (404 UNKNOWN_DOMAIN).
 * Force a specific backend with `DNS_PROVIDER=kinsta|godaddy|manual|cloud-dns`.
 */
import { type DnsProvider } from "./provider.js";
import { GoDaddyDnsProvider, getGoDaddyConfig } from "./godaddy.js";
import { KinstaDnsProvider, getKinstaConfig } from "./kinsta.js";
import { ManualDnsProvider } from "./manual.js";
import { CloudDnsProvider } from "./cloud-dns.js";

export function resolveDnsProvider(env: NodeJS.ProcessEnv = process.env): DnsProvider {
  const mode = env.DNS_PROVIDER?.trim().toLowerCase();
  if (mode === "manual") return new ManualDnsProvider();
  if (mode === "cloud-dns") return new CloudDnsProvider();

  const kinsta = getKinstaConfig(env);
  const gd = getGoDaddyConfig(env);

  if (mode === "kinsta") {
    if (!kinsta) {
      throw new Error("DNS_PROVIDER=kinsta but KINSTA_API_KEY/KINSTA_COMPANY_ID are not set");
    }
    return new KinstaDnsProvider(kinsta);
  }
  if (mode === "godaddy") {
    if (!gd) {
      throw new Error("DNS_PROVIDER=godaddy but GODADDY_API_KEY/GODADDY_API_SECRET are not set");
    }
    return new GoDaddyDnsProvider(gd);
  }
  if (mode) {
    throw new Error(
      `Unknown DNS_PROVIDER=${JSON.stringify(env.DNS_PROVIDER)}; valid values: kinsta, godaddy, manual, cloud-dns`,
    );
  }

  if (kinsta) return new KinstaDnsProvider(kinsta);
  return gd ? new GoDaddyDnsProvider(gd) : new ManualDnsProvider();
}
