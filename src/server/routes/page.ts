import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { renderNotFound, renderPage, type PageRecord } from "../render-page.js";
// Side-effect: register the three static block types so SSR can resolve them.
import "../../blocks/index.js";

export function pageRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();

  router.use(resolveSite({ pool, passThroughOnMiss: true }));

  router.get(/.*/, async (req: Request, res: Response, next: NextFunction) => {
    if (!req.site) {
      // Unknown host — let downstream (Vite/SPA) handle it.
      next();
      return;
    }

    const slug = normalizeSlug(req.path);

    try {
      const result = await pool.query<PageRecord>(
        `SELECT title, blocks, seo
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

      const { html, status } = renderPage(req.site, result.rows[0]);
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
