import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { postInputSchema, postPatchSchema } from "../blog/schema.js";
import {
  createPost,
  deletePost,
  getPostById,
  listPosts,
  updatePost,
  InvalidPostBodyError,
  PostSlugConflictError,
  type Post,
} from "../blog/repo.js";

/**
 * Admin tenant-content API (P8-T8.13, D-047). The Studio surface for a site's
 * per-tenant content: blog posts, events, and member/auth config. Mounted at
 * `/api`, gated per-route by `requireAdmin`, and EVERY query is scoped by the
 * `:siteId` path param (multi-tenant — D-048). Mirrors the admin-pages /
 * admin-sites routers: per-route `admin` so unmatched `/api/*` paths fall
 * through to a 404 rather than 401.
 *
 * Post/event `body`/`description` are `Block[]` (D-001), edited in Studio via
 * the same Puck editor as pages and re-validated against the block registry by
 * the repos (D-039) — a tenant post can never hold blocks the renderer rejects.
 */

/** List rows omit the heavy `body`/`description` Block[] (mirrors the pages list). */
function stripPostBody(p: Post): Omit<Post, "body"> {
  const { body: _body, ...rest } = p;
  return rest;
}

function zodDetails(err: import("zod").ZodError) {
  return err.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message }));
}

export type AdminTenantOptions = { pool?: Pool };

export function adminTenantRouter(opts: AdminTenantOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();

  /** 404 if the site doesn't exist; returns true when it does. */
  async function siteExists(siteId: string): Promise<boolean> {
    const r = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ===========================================================================
  // Blog posts
  // ===========================================================================

  // GET /api/sites/:siteId/posts[?status=draft|published] — list (body omitted).
  router.get(
    "/sites/:siteId/posts",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const status = req.query.status === "draft" || req.query.status === "published"
          ? req.query.status
          : undefined;
        const posts = await listPosts(pool, siteId, { status });
        res.json({ posts: posts.map(stripPostBody) });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/sites/:siteId/posts — create a post.
  router.post(
    "/sites/:siteId/posts",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = postInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload", details: zodDetails(parsed.error) });
        return;
      }
      try {
        const { siteId } = req.params;
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const post = await createPost(pool, siteId, parsed.data);
        res.status(201).json({ post });
      } catch (err) {
        if (err instanceof PostSlugConflictError) {
          res.status(409).json({ error: "a post with that slug already exists on this site" });
          return;
        }
        if (err instanceof InvalidPostBodyError) {
          res.status(400).json({ error: "post body failed block validation", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/posts/:postId — full post (incl. body) for the editor.
  router.get(
    "/sites/:siteId/posts/:postId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, postId } = req.params;
        const post = await getPostById(pool, siteId, postId);
        if (!post) {
          res.status(404).json({ error: "post not found for this site" });
          return;
        }
        res.json({ post });
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /api/sites/:siteId/posts/:postId — update fields/body/status.
  router.put(
    "/sites/:siteId/posts/:postId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = postPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload", details: zodDetails(parsed.error) });
        return;
      }
      try {
        const { siteId, postId } = req.params;
        const post = await updatePost(pool, siteId, postId, parsed.data);
        if (!post) {
          res.status(404).json({ error: "post not found for this site" });
          return;
        }
        res.json({ post });
      } catch (err) {
        if (err instanceof PostSlugConflictError) {
          res.status(409).json({ error: "a post with that slug already exists on this site" });
          return;
        }
        if (err instanceof InvalidPostBodyError) {
          res.status(400).json({ error: "post body failed block validation", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // DELETE /api/sites/:siteId/posts/:postId — remove a post.
  router.delete(
    "/sites/:siteId/posts/:postId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, postId } = req.params;
        const deleted = await deletePost(pool, siteId, postId);
        if (!deleted) {
          res.status(404).json({ error: "post not found for this site" });
          return;
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
