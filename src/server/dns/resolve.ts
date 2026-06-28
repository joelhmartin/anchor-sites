/**
 * Pick the DNS provider from the environment, mirroring
 * `resolveStudioAuthMode`. Default: GoDaddy when creds are present, else
 * "manual" (graceful degradation — never crash for missing creds). Force a
 * specific backend with `DNS_PROVIDER=godaddy|manual|cloud-dns`.
 */
import { type DnsProvider } from "./provider.js";
import { GoDaddyDnsProvider, getGoDaddyConfig } from "./godaddy.js";
import { ManualDnsProvider } from "./manual.js";
import { CloudDnsProvider } from "./cloud-dns.js";

export function resolveDnsProvider(env: NodeJS.ProcessEnv = process.env): DnsProvider {
  const mode = env.DNS_PROVIDER?.trim().toLowerCase();
  if (mode === "manual") return new ManualDnsProvider();
  if (mode === "cloud-dns") return new CloudDnsProvider();

  const gd = getGoDaddyConfig(env);
  if (mode === "godaddy") {
    if (!gd) {
      throw new Error("DNS_PROVIDER=godaddy but GODADDY_API_KEY/GODADDY_API_SECRET are not set");
    }
    return new GoDaddyDnsProvider(gd);
  }
  return gd ? new GoDaddyDnsProvider(gd) : new ManualDnsProvider();
}
