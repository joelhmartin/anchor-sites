/**
 * Public URL for a tenant site. Mirrors the server default `SITES_DOMAIN_BASE`
 * (src/config/domain.ts). Real custom domains arrive in Phase 10; until then
 * every site is reachable at its canonical `<slug>.sites.anchorcorps.com` host.
 */
const SITES_DOMAIN_BASE = "sites.anchorcorps.com";

/** Canonical tenant hostname for a slug, e.g. `acme.sites.anchorcorps.com`. */
export function tenantHostname(slug: string): string {
  return `${slug}.${SITES_DOMAIN_BASE}`;
}

export function liveSiteUrl(slug: string): string {
  return `https://${tenantHostname(slug)}`;
}
