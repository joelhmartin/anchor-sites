import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../server/db.js";
import { hostnameForSlug, subdomainPattern } from "../config/domain.js";
import { publicDisplayName } from "../shared/public-name.js";

// Reserved per D-016 — Phase 7.5 will populate this from `site_plugins`. Empty
// array in Phase 1 so downstream consumers can already iterate without retrofit.
export type PluginInstance = {
  name: string;
  version: string;
};

export type ResolvedSite = {
  id: string;
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown>;
  /** P9-T9.3 — site-level SEO defaults (`sites.seo_defaults`), applied under per-page seo. */
  seo_defaults: Record<string, unknown>;
  /** P11-T11.1 (D-052) — CTM account ID; null/undefined = CTM not installed for this site. */
  ctm_account_id: string | null;
  /** P12-T12.1 (D-054) — when true, analytics script injection is skipped for this site. */
  analytics_disabled: boolean;
  matched_via: "domain" | "subdomain";
  plugins: PluginInstance[];
};

declare module "express-serve-static-core" {
  interface Request {
    site?: ResolvedSite;
    /** Set by the page router when the request targets the admin control hub (D-032). */
    isAdminHost?: boolean;
  }
}

const TTL_MS = 60_000;
type CacheEntry = { site: ResolvedSite | null; expires: number };

// Per-process Map cache. Redis-backed cache lands when scale demands it.
const cache = new Map<string, CacheEntry>();

export function __clearResolveSiteCacheForTests(): void {
  cache.clear();
}

/**
 * Evict a single hostname's cached resolution. Call from any code path
 * that mutates `sites` / `site_domains` so the next request sees fresh
 * data without waiting out the 60s TTL. Same-process only; multi-instance
 * Pub/Sub broadcast is deferred to Phase 12 hardening (D-022 / P3-T3.1).
 *
 * Idempotent: no-op when the hostname isn't cached.
 */
export function evictSiteCache(hostname: string): void {
  cache.delete(stripPort(hostname));
}

/** Number of entries currently cached. Exposed for debug/admin endpoints. */
export function resolveSiteCacheSize(): number {
  return cache.size;
}

/**
 * Evict every hostname that resolves to a given site — its explicit
 * `site_domains` rows plus the canonical `<slug>.<base>` + `<slug>.localhost`
 * subdomain forms. Call after mutating a site's plugins (P7.5-T7.5.6) so the
 * next request re-resolves `req.site.plugins` instead of waiting out the TTL.
 * Idempotent; uncached hosts are no-ops.
 */
export async function evictSiteCacheForSite(pool: Pool, siteId: string): Promise<void> {
  const res = await pool.query<{ slug: string; hostname: string | null }>(
    `SELECT s.slug, d.hostname
       FROM sites s
       LEFT JOIN site_domains d ON d.site_id = s.id
      WHERE s.id = $1`,
    [siteId],
  );
  const hosts = new Set<string>();
  for (const row of res.rows) {
    if (row.slug) {
      try {
        hosts.add(hostnameForSlug(row.slug));
      } catch {
        /* invalid slug for hostname — skip */
      }
      hosts.add(`${row.slug}.localhost`);
    }
    if (row.hostname) hosts.add(row.hostname.toLowerCase());
  }
  for (const h of hosts) evictSiteCache(h);
}

/**
 * Internal lookup with cache awareness, decoupled from the middleware so
 * debug endpoints (`/__site_resolve`) can reuse the path without
 * mutating `req`. Returns the resolved site (or null) plus whether the
 * cache served it.
 */
export async function lookupSiteForDebug(
  pool: Pool,
  hostname: string,
): Promise<{ site: ResolvedSite | null; cache_hit: boolean }> {
  const key = stripPort(hostname);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return { site: cached.site, cache_hit: true };
  }
  const site = await lookupSite(pool, key);
  cache.set(key, { site, expires: now + TTL_MS });
  return { site, cache_hit: false };
}

// Subdomain fallback for sites that don't have an explicit site_domains row.
// Pattern comes from the centralized domain config so the parent domain
// (`sites.anchorcorps.com` by default) can be swapped via the
// `SITES_DOMAIN_BASE` env var. Computed lazily so tests that mutate
// `process.env` pick up the change without re-importing the module.
function currentSubdomainPattern(): RegExp {
  return subdomainPattern();
}

function stripPort(host: string): string {
  const portIdx = host.indexOf(":");
  return (portIdx === -1 ? host : host.slice(0, portIdx)).toLowerCase();
}

type SiteRow = {
  id: string;
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown> | null;
  seo_defaults: Record<string, unknown> | null;
  ctm_account_id: string | null;
  analytics_disabled: boolean;
  plugins: PluginInstance[] | null;
};

// The site's ENABLED plugins, aggregated in the SAME query as the site lookup
// (P7.5-T7.5.5, D-016) so the hot resolve path stays at one round-trip per
// cache miss. Cached with the site for the TTL; enable/disable evicts the host
// (the plugins admin route calls `evictSiteCache`) so toggles take effect.
const PLUGINS_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('name', sp.plugin_name, 'version', sp.version)
                  ORDER BY sp.plugin_name)
    FROM site_plugins sp
   WHERE sp.site_id = s.id AND sp.enabled = true
), '[]'::json) AS plugins`;

async function lookupSite(pool: Pool, hostname: string): Promise<ResolvedSite | null> {
  const domainRes = await pool.query<SiteRow>(
    `SELECT s.id, s.slug, s.display_name, s.default_brand_tokens, s.seo_defaults,
            s.ctm_account_id, s.analytics_disabled, ${PLUGINS_SUBQUERY}
       FROM site_domains d
       JOIN sites s ON s.id = d.site_id
      WHERE d.hostname = $1 AND s.status = 'active'
      LIMIT 1`,
    [hostname],
  );
  if (domainRes.rowCount && domainRes.rowCount > 0) {
    return toResolvedSite(domainRes.rows[0], "domain");
  }

  const match = currentSubdomainPattern().exec(hostname);
  if (match) {
    const slug = match[1].toLowerCase();
    const slugRes = await pool.query<SiteRow>(
      `SELECT s.id, s.slug, s.display_name, s.default_brand_tokens, s.seo_defaults,
              s.ctm_account_id, s.analytics_disabled, ${PLUGINS_SUBQUERY}
         FROM sites s WHERE s.slug = $1 AND s.status = 'active' LIMIT 1`,
      [slug],
    );
    if (slugRes.rowCount && slugRes.rowCount > 0) {
      return toResolvedSite(slugRes.rows[0], "subdomain");
    }
  }

  return null;
}

function toResolvedSite(row: SiteRow, matched_via: ResolvedSite["matched_via"]): ResolvedSite {
  return {
    id: row.id,
    slug: row.slug,
    // D911 — resolveSite is the single gate every PUBLIC tenant surface goes
    // through (pages, blog/events, sitemap, leads, previews), so stripping
    // seed placeholder markers here keeps them out of og:site_name, JSON-LD,
    // titles and the rendered chrome in one move. Admin APIs query `sites`
    // directly and still see the raw name (the Studio nudges a rename).
    display_name: publicDisplayName(row.display_name, row.slug),
    default_brand_tokens: row.default_brand_tokens ?? {},
    seo_defaults: row.seo_defaults ?? {},
    ctm_account_id: row.ctm_account_id ?? null,
    analytics_disabled: row.analytics_disabled ?? false,
    matched_via,
    plugins: row.plugins ?? [],
  };
}

export type ResolveSiteOptions = {
  pool?: Pool;
  /**
   * When true, an unknown host calls `next()` with no `req.site` attached
   * instead of responding 404. Used by the catch-all page route so the SPA
   * dev server (Vite) can still handle `localhost` requests downstream.
   */
  passThroughOnMiss?: boolean;
};

export function resolveSite(opts: ResolveSiteOptions = {}): RequestHandler {
  const pool = opts.pool ?? defaultPool;
  const passThroughOnMiss = opts.passThroughOnMiss ?? false;

  return async (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      if (passThroughOnMiss) {
        next();
        return;
      }
      res.status(404).type("text/plain").send("Site not found");
      return;
    }
    const hostname = stripPort(hostHeader);

    const now = Date.now();
    const cached = cache.get(hostname);
    let site: ResolvedSite | null;
    if (cached && cached.expires > now) {
      site = cached.site;
    } else {
      try {
        site = await lookupSite(pool, hostname);
      } catch (err) {
        next(err);
        return;
      }
      cache.set(hostname, { site, expires: now + TTL_MS });
    }

    if (!site) {
      if (passThroughOnMiss) {
        next();
        return;
      }
      res.status(404).type("text/plain").send("Site not found");
      return;
    }

    req.site = site;
    next();
  };
}
