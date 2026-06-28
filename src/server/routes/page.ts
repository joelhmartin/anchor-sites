import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { isAdminHost } from "../../config/admin-host.js";
import { renderNotFound, renderPage, type PageRecord } from "../render-page.js";
import { loadAssetsForBlocks } from "../render-hydration.js";
import { loadOgImage } from "../seo/og-image.js";
import { parseSeoLoose, parseSiteSeoDefaultsLoose } from "../seo/schema.js";
// Side-effect: register the three static block types so SSR can resolve them.
import "../../blocks/index.js";

export function pageRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  // The admin control hub (studio.anchorcorps.com / studio.localhost) is
  // never a tenant — short-circuit before resolveSite so it's always
  // served by the downstream SPA, even if a stray site_domains row existed
  // for that hostname (D-032 / P4-T4.1).
  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (isAdminHost(req.headers.host)) {
      req.isAdminHost = true;
    }
    next();
  });

  router.use(resolveSite({ pool, passThroughOnMiss: true }));

  router.get(/.*/, async (req: Request, res: Response, next: NextFunction) => {
    if (req.isAdminHost || !req.site) {
      // Admin host or unknown host — let downstream (Vite/SPA) handle it.
      next();
      return;
    }

    const slug = normalizeSlug(req.path);

    try {
      const result = await pool.query<PageRecord>(
        `SELECT title, blocks, seo, brand_tokens_override
           FROM pages
          WHERE site_id = $1 AND slug = $2 AND status = 'published'
          LIMIT 1`,
        [req.site.id, slug],
      );

      if (result.rowCount === 0) {
        const { html, status } = renderNotFound(req.site);
        res.status(status).type("text/html").send(html);
        return;
      }

      // P3-T3.14 — hydrate media_assets referenced by the page's blocks
      // before SSR so MediaProvider can resolve asset_ids.
      const assets = await loadAssetsForBlocks(
        pool,
        req.site.id,
        result.rows[0].blocks,
      );
      const pageSeo = parseSeoLoose(result.rows[0].seo);
      const siteDefaults = parseSiteSeoDefaultsLoose(req.site.seo_defaults);
      const ogImage = await loadOgImage(
        pool,
        req.site.id,
        pageSeo.og?.imageAssetId ?? siteDefaults.defaultOgImageAssetId,
      );
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
