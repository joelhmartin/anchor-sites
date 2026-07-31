import { Router } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { flagAdminHost } from "../../middleware/flagAdminHost.js";
import { hostnameForSlug } from "../../config/domain.js";

/**
 * Per-tenant `/sitemap.xml` and `/robots.txt` (P9-T9.5/9.6, D-049). Dynamic on
 * request — small sites, always fresh. Lists published pages + posts + events
 * (excluding anything marked `robots.index=false`). Admin host / unknown host →
 * `next()` so the Studio SPA and page router keep their routes.
 */

type Url = { loc: string; lastmod?: string };

const XML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESC[c]);
}

function buildSitemap(urls: Url[]): string {
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// Published, indexable rows for one content table, newest-changed first.
// D301: `lastmodExpr` — pages advertise `published_at` (when the live
// content last changed), because a draft edit bumps `updated_at` without
// shipping anything; posts/events edits DO go live directly, so their
// `updated_at` remains the honest freshness signal.
const indexableQuery = (table: string, lastmodExpr = "updated_at") =>
  `SELECT slug, to_char(${lastmodExpr}, 'YYYY-MM-DD') AS lastmod
     FROM ${table}
    WHERE site_id = $1 AND status = 'published'
      AND (seo->'robots'->>'index') IS DISTINCT FROM 'false'
    ORDER BY (slug = 'home') DESC, slug`;

export function sitemapRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const guards = [flagAdminHost, resolveSite({ pool, passThroughOnMiss: true })];

  router.get("/sitemap.xml", ...guards, async (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    try {
      const base = `https://${hostnameForSlug(site.slug)}`;
      const [pages, posts, events] = await Promise.all([
        pool.query<{ slug: string; lastmod: string }>(
          indexableQuery("pages", "COALESCE(published_at, updated_at)"),
          [site.id],
        ),
        pool.query<{ slug: string; lastmod: string }>(indexableQuery("posts"), [site.id]),
        pool.query<{ slug: string; lastmod: string }>(indexableQuery("events"), [site.id]),
      ]);

      const urls: Url[] = [];
      for (const p of pages.rows) {
        urls.push({ loc: `${base}${p.slug === "home" ? "/" : `/${p.slug}`}`, lastmod: p.lastmod });
      }
      if (posts.rowCount) urls.push({ loc: `${base}/blog` });
      for (const p of posts.rows) urls.push({ loc: `${base}/blog/${p.slug}`, lastmod: p.lastmod });
      if (events.rowCount) urls.push({ loc: `${base}/events` });
      for (const e of events.rows) urls.push({ loc: `${base}/events/${e.slug}`, lastmod: e.lastmod });

      res.status(200).type("application/xml").send(buildSitemap(urls));
    } catch (err) {
      next(err);
    }
  });

  router.get("/robots.txt", ...guards, (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    const base = `https://${hostnameForSlug(site.slug)}`;
    const body = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
    res.status(200).type("text/plain").send(body);
  });

  return router;
}
