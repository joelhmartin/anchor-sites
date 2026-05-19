/**
 * Single source of truth for the multi-tenant hostname scheme.
 *
 * The system has two domains it needs to know about:
 *
 *   - `SITES_DOMAIN_BASE` — the wildcard parent every tenant lives under.
 *     Defaults to `sites.anchorcorps.com`. Override in `.env` (local) or
 *     Secret Manager (prod) to swap the whole platform onto a different
 *     domain — for example, repointing to `tenants.acmegroup.com` would be
 *     a single env-var change plus a re-seed.
 *
 *   - `SITES_DOMAIN_REGISTRABLE` — the registrable apex the wildcard lives
 *     beneath. Defaults to `anchorcorps.com`. The Kinsta DNS client uses
 *     this to look up the zone via `/v2/domains?company=...`. Search Console
 *     ownership verification also lives at this level.
 *
 * Helpers (`hostnameForSlug`, `subdomainPattern`, `isUnderSitesDomain`) are
 * the only API call sites should use — never hand-build hostnames.
 */

const DEFAULT_BASE = "sites.anchorcorps.com";
const DEFAULT_REGISTRABLE = "anchorcorps.com";

function readBase(): string {
  const raw = process.env.SITES_DOMAIN_BASE?.trim();
  if (!raw) return DEFAULT_BASE;
  // Strip any leading/trailing dots or whitespace; lowercase.
  return raw.replace(/^\.+|\.+$/g, "").toLowerCase();
}

function readRegistrable(): string {
  const raw = process.env.SITES_DOMAIN_REGISTRABLE?.trim();
  if (raw) return raw.replace(/^\.+|\.+$/g, "").toLowerCase();
  // Default: take the last two labels of base. `sites.anchorcorps.com` →
  // `anchorcorps.com`. Two labels is the common case; ccTLDs like `.co.uk`
  // would need an explicit override.
  const base = readBase();
  const parts = base.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return DEFAULT_REGISTRABLE;
}

export type DomainConfig = {
  /** Wildcard parent, e.g. `sites.anchorcorps.com`. */
  base: string;
  /** Registrable apex, e.g. `anchorcorps.com`. */
  registrable: string;
};

export function getDomainConfig(): DomainConfig {
  return { base: readBase(), registrable: readRegistrable() };
}

/**
 * Build the canonical FQDN for a site given its slug.
 * `muldoon-dental` → `muldoon-dental.sites.anchorcorps.com`
 */
export function hostnameForSlug(slug: string, cfg: DomainConfig = getDomainConfig()): string {
  const safe = slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(safe)) {
    throw new Error(
      `invalid slug for hostname: ${JSON.stringify(slug)} — must be lowercase a-z, 0-9, hyphen; cannot start or end with hyphen`,
    );
  }
  return `${safe}.${cfg.base}`;
}

/**
 * Regex matching `<label>.<base>` where label is the captured slug. Used by
 * `resolveSite` to fall back from the explicit `site_domains` table to
 * resolving a hostname by extracting the leading label and matching against
 * `sites.slug`.
 *
 * The regex is intentionally narrow — only the configured base matches.
 * Non-base subdomains under the same registrable apex (mail, www, blog)
 * never get mis-routed to the builder.
 */
export function subdomainPattern(cfg: DomainConfig = getDomainConfig()): RegExp {
  const escaped = cfg.base.replace(/\./g, "\\.");
  return new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${escaped}$`, "i");
}

export function isUnderSitesDomain(
  hostname: string,
  cfg: DomainConfig = getDomainConfig(),
): boolean {
  return subdomainPattern(cfg).test(hostname);
}
