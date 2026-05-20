/**
 * Public URL for a tenant site. Mirrors the server default `SITES_DOMAIN_BASE`
 * (src/config/domain.ts). Real custom domains arrive in Phase 10; until then
 * every site is reachable at its canonical `<slug>.sites.anchorcorps.com` host.
 */
const SITES_DOMAIN_BASE = "sites.anchorcorps.com";

export function liveSiteUrl(slug: string): string {
  return `https://${slug}.${SITES_DOMAIN_BASE}`;
}
