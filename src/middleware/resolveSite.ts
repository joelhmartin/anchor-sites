import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../server/db.js";

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
  matched_via: "domain" | "subdomain";
  plugins: PluginInstance[];
};

declare module "express-serve-static-core" {
  interface Request {
    site?: ResolvedSite;
  }
}

const TTL_MS = 60_000;
type CacheEntry = { site: ResolvedSite | null; expires: number };

// Per-process Map cache. Redis-backed cache lands when scale demands it.
const cache = new Map<string, CacheEntry>();

export function __clearResolveSiteCacheForTests(): void {
  cache.clear();
}

// Subdomain fallback for sites that don't have an explicit site_domains row
// yet. `muldoon.preview.anchorcorps.dev` and `muldoon.anchorcorps.dev` both
// map to whichever site has `slug = 'muldoon'`.
const SUBDOMAIN_RE = /^([a-z0-9][a-z0-9-]*)\.(?:preview\.)?anchorcorps\.dev$/i;

function stripPort(host: string): string {
  const portIdx = host.indexOf(":");
  return (portIdx === -1 ? host : host.slice(0, portIdx)).toLowerCase();
}

type SiteRow = {
  id: string;
  slug: string;
  display_name: string;
  default_brand_tokens: Record<string, unknown> | null;
};

async function lookupSite(pool: Pool, hostname: string): Promise<ResolvedSite | null> {
  const domainRes = await pool.query<SiteRow>(
    `SELECT s.id, s.slug, s.display_name, s.default_brand_tokens
       FROM site_domains d
       JOIN sites s ON s.id = d.site_id
      WHERE d.hostname = $1 AND s.status = 'active'
      LIMIT 1`,
    [hostname],
  );
  if (domainRes.rowCount && domainRes.rowCount > 0) {
    return toResolvedSite(domainRes.rows[0], "domain");
  }

  const match = SUBDOMAIN_RE.exec(hostname);
  if (match) {
    const slug = match[1].toLowerCase();
    const slugRes = await pool.query<SiteRow>(
      `SELECT id, slug, display_name, default_brand_tokens
         FROM sites WHERE slug = $1 AND status = 'active' LIMIT 1`,
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
    display_name: row.display_name,
    default_brand_tokens: row.default_brand_tokens ?? {},
    matched_via,
    plugins: [],
  };
}

export type ResolveSiteOptions = {
  pool?: Pool;
};

export function resolveSite(opts: ResolveSiteOptions = {}): RequestHandler {
  const pool = opts.pool ?? defaultPool;

  return async (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
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
      res.status(404).type("text/plain").send("Site not found");
      return;
    }

    req.site = site;
    next();
  };
}
