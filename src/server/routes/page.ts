import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { flagAdminHost } from "../../middleware/flagAdminHost.js";
import { renderComingSoon, renderNotFound, renderPage, type PageRecord } from "../render-page.js";
import { loadAssetsForBlocks } from "../render-hydration.js";
import { resolveOgImage } from "../seo/og-image.js";
import { parseSeoLoose } from "../seo/schema.js";
// Side-effect: register the three static block types so SSR can resolve them.
import "../../blocks/index.js";

export function pageRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  // The admin control hub (studio.anchorcorps.com / studio.localhost) is
  // never a tenant — short-circuit before resolveSite so it's always served by
  // the downstream SPA, even if a stray site_domains row existed for that
  // hostname (D-032 / P4-T4.1).
  router.use(flagAdminHost);

  router.use(resolveSite({ pool, passThroughOnMiss: true }));

  router.get(/.*/, async (req: Request, res: Response, next: NextFunction) => {
    if (req.isAdminHost || !req.site) {
      // Admin host or unknown host — let downstream (Vite/SPA) handle it.
      next();
      return;
    }

    const slug = normalizeSlug(req.path);

    try {
      // D301 snapshot-on-publish: the live site serves ONLY the frozen
      // publish-time payload, never the working columns — post-publish
      // edits (agent, inline editor, SEO tab) stay off the live site until
      // the next publish. Fails closed: a published row missing its
      // snapshot renders nothing rather than leaking the draft (the
      // migration backfilled every pre-existing published row, and every
      // publish path writes the snapshot — see src/server/publish-snapshot.ts).
      const result = await pool.query<PageRecord>(
        `SELECT published_snapshot->>'title'              AS title,
                published_snapshot->'blocks'              AS blocks,
                published_snapshot->'seo'                 AS seo,
                published_snapshot->'brand_tokens_override' AS brand_tokens_override
           FROM pages
          WHERE site_id = $1 AND slug = $2 AND status = 'published'
            AND published_snapshot IS NOT NULL
          LIMIT 1`,
        [req.site.id, slug],
      );

      if (result.rowCount === 0) {
        // D904: no published home means the site's ROOT — the exact URL the
        // operator was handed at provisioning — used to be a 404 error page
        // until first publish. A missing home is a deliberate "nothing
        // published yet" state, so the root renders a branded, noindex
        // coming-soon instead. Non-home slugs keep the honest 404.
        const { html, status } =
          slug === "home" ? renderComingSoon(req.site) : renderNotFound(req.site);
        res.status(status).type("text/html").send(html);
        return;
      }

      // P3-T3.14 — hydrate block media + P9-T9.4 resolve og:image. Both are
      // independent DB reads, so run them concurrently (one round-trip latency).
      const pageSeo = parseSeoLoose(result.rows[0].seo);
      const [assets, ogImage] = await Promise.all([
        loadAssetsForBlocks(pool, req.site.id, result.rows[0].blocks),
        resolveOgImage(pool, req.site, pageSeo),
      ]);
      const { html, status } = renderPage(req.site, result.rows[0], {
        assets,
        path: req.path,
        ogImage: ogImage ?? undefined,
      });
      res.status(status).type("text/html").send(html);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function normalizeSlug(path: string): string {
  if (path === "/" || path === "") return "home";
  let slug = path.replace(/^\/+/, "");
  if (slug.endsWith("/")) slug = slug.slice(0, -1);
  return slug || "home";
}
