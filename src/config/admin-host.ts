/**
 * Admin control-hub host (D-032, P4-T4.1).
 *
 * The admin SPA lives at `studio.anchorcorps.com` — a TOP-LEVEL sibling
 * to the `*.sites.anchorcorps.com` tenant wildcard, deliberately NOT
 * under `sites.`:
 *   - It's not a DNS parent of any tenant host, so admin session cookies
 *     (Phase 8 / Better-auth) can't leak onto public tenant sites by
 *     default — a clean auth boundary by construction.
 *   - It never collides with the tenant resolver regex (which only
 *     matches `<label>.sites.anchorcorps.com`).
 *
 * The same single Express + Vite process serves both surfaces; the page
 * router consults `isAdminHost` and serves the SPA (never tenant content)
 * for the admin host.
 *
 * Override `STUDIO_HOST` to repoint the hub (e.g. a staging host). The
 * local-dev hostname `studio.localhost` is always recognized so the SPA
 * can be exercised without DNS.
 */

const DEFAULT_STUDIO_HOST = "studio.anchorcorps.com";
const LOCAL_STUDIO_HOST = "studio.localhost";

function stripPort(host: string): string {
  const i = host.indexOf(":");
  return (i === -1 ? host : host.slice(0, i)).toLowerCase();
}

export function studioHost(): string {
  const raw = process.env.STUDIO_HOST?.trim().toLowerCase();
  return raw ? stripPort(raw) : DEFAULT_STUDIO_HOST;
}

/**
 * True when the request host is the admin control hub. Accepts the
 * configured `STUDIO_HOST` (default `studio.anchorcorps.com`) and the
 * local-dev `studio.localhost`. Port-insensitive.
 */
export function isAdminHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = stripPort(host);
  return h === studioHost() || h === LOCAL_STUDIO_HOST;
}
