import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveSite } from "../../middleware/resolveSite.js";
import { isAdminHost } from "../../config/admin-host.js";
import { canonicalUrl, renderNotFound, renderPage, type PageRecord } from "../render-page.js";
import { loadAssetsForBlocks } from "../render-hydration.js";
import type { Block } from "../../blocks/types.js";
import { getPostBySlug, listPosts } from "../blog/repo.js";
import { getEventBySlug, listEvents } from "../events/repo.js";
import { loadOgImage, type OgImage } from "../seo/og-image.js";
import { parseSeoLoose, parseSiteSeoDefaultsLoose } from "../seo/schema.js";
import { blogPostingLd, eventLd } from "../seo/json-ld.js";
import "../../blocks/index.js"; // side-effect: register blocks for SSR

/**
 * Public blog + events rendering on TENANT hosts (P8-T8.11, D-047). Mounted
 * before the catch-all page router. Detail pages render the post/event `body`
 * (a `Block[]`, D-001) through the SAME block renderer + site shell as pages;
 * list pages render a synthesized rich-text index. Published items only;
 * unknown slug → the site's 404. Admin host / unknown host → `next()` (the SPA
 * / page router handles it), so these routes never hijack the Studio surface.
 */
const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function flagAdminHost(req: Request, _res: Response, next: NextFunction): void {
  if (isAdminHost(req.headers.host)) req.isAdminHost = true;
  next();
}

export function blogEventsRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const guards = [flagAdminHost, resolveSite({ pool, passThroughOnMiss: true })];

  async function renderBlocks(
    req: Request,
    res: Response,
    siteId: string,
    title: string,
    blocks: Block[],
    extra: {
      seo?: Record<string, unknown>;
      path?: string;
      ogImage?: OgImage;
      extraJsonLd?: Array<Record<string, unknown>>;
    } = {},
  ): Promise<void> {
    const record: PageRecord = {
      title,
      blocks,
      seo: extra.seo ?? {},
      brand_tokens_override: {},
    };
    const assets = await loadAssetsForBlocks(pool, siteId, blocks);
    const { html, status } = renderPage(req.site!, record, {
      assets,
      path: extra.path ?? req.path,
      ogImage: extra.ogImage,
      extraJsonLd: extra.extraJsonLd,
    });
    res.status(status).type("text/html").send(html);
  }

  /** Resolve a post/event's og:image: its own seo asset, else the site default. */
  async function resolveOg(
    site: { id: string; seo_defaults: Record<string, unknown> },
    seo: ReturnType<typeof parseSeoLoose>,
  ): Promise<OgImage | null> {
    const defaults = parseSiteSeoDefaultsLoose(site.seo_defaults);
    return loadOgImage(pool, site.id, seo.og?.imageAssetId ?? defaults.defaultOgImageAssetId);
  }

  function indexBlock(id: string, html: string): Block[] {
    return [{ id, type: "rich-text", props: { html } }] as unknown as Block[];
  }

  router.get("/blog", ...guards, async (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    try {
      const posts = await listPosts(pool, site.id, { status: "published" });
      const items = posts
        .map(
          (p) =>
            `<li><a href="/blog/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a>` +
            (p.excerpt ? ` — ${escapeHtml(p.excerpt)}` : "") +
            `</li>`,
        )
        .join("");
      const html = `<h1>Blog</h1><ul class="ac-post-list">${items || "<li>No posts yet.</li>"}</ul>`;
      await renderBlocks(req, res, site.id, "Blog", indexBlock("blog-index", html));
    } catch (err) {
      next(err);
    }
  });

  router.get("/blog/:slug", ...guards, async (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    try {
      const post = await getPostBySlug(pool, site.id, req.params.slug);
      if (!post || post.status !== "published") {
        const { html, status } = renderNotFound(site);
        res.status(status).type("text/html").send(html);
        return;
      }
      const postSeo = parseSeoLoose(post.seo);
      const ogImage = await resolveOg(site, postSeo);
      const path = `/blog/${post.slug}`;
      const url = canonicalUrl(site, postSeo, path);
      const ld = blogPostingLd({
        site,
        headline: post.title,
        description: postSeo.description,
        url: url ?? path,
        image: ogImage?.url,
        datePublished: post.published_at,
      });
      await renderBlocks(req, res, site.id, post.title, post.body as unknown as Block[], {
        seo: post.seo,
        path,
        ogImage: ogImage ?? undefined,
        extraJsonLd: [ld],
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/events", ...guards, async (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    try {
      const events = await listEvents(pool, site.id, { status: "published" });
      const items = events
        .map((e) => {
          const date = e.starts_at ? e.starts_at.slice(0, 10) : "";
          return (
            `<li><a href="/events/${encodeURIComponent(e.slug)}">${escapeHtml(e.title)}</a> — ${date}` +
            (e.location ? ` @ ${escapeHtml(e.location)}` : "") +
            `</li>`
          );
        })
        .join("");
      const html = `<h1>Events</h1><ul class="ac-event-list">${items || "<li>No upcoming events.</li>"}</ul>`;
      await renderBlocks(req, res, site.id, "Events", indexBlock("events-index", html));
    } catch (err) {
      next(err);
    }
  });

  router.get("/events/:slug", ...guards, async (req, res, next) => {
    const site = req.site;
    if (req.isAdminHost || !site) return next();
    try {
      const event = await getEventBySlug(pool, site.id, req.params.slug);
      if (!event || event.status !== "published") {
        const { html, status } = renderNotFound(site);
        res.status(status).type("text/html").send(html);
        return;
      }
      const eventSeo = parseSeoLoose(event.seo);
      const ogImage = await resolveOg(site, eventSeo);
      const path = `/events/${event.slug}`;
      const url = canonicalUrl(site, eventSeo, path);
      const ld = eventLd({
        name: event.title,
        description: eventSeo.description,
        url: url ?? path,
        image: ogImage?.url,
        startDate: event.starts_at,
        endDate: event.ends_at,
        location: event.location,
      });
      await renderBlocks(req, res, site.id, event.title, event.description as unknown as Block[], {
        seo: event.seo,
        path,
        ogImage: ogImage ?? undefined,
        extraJsonLd: [ld],
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
