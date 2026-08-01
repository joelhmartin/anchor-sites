import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
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
import { eventInputSchema, eventPatchSchema } from "../events/schema.js";
import {
  createEvent,
  deleteEvent,
  getEventById,
  listEvents,
  updateEvent,
  EventSlugConflictError,
  InvalidEventDescriptionError,
  type EventRecord,
} from "../events/repo.js";

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

function stripEventDescription(e: EventRecord): Omit<EventRecord, "description"> {
  const { description: _description, ...rest } = e;
  return rest;
}

function zodDetails(err: z.ZodError) {
  return err.errors.map((e) => ({ path: e.path.join(".") || "(root)", message: e.message }));
}

// Per-site login providers (D-048, v1 = email+password). `.strict()` rejects
// unknown provider keys so a typo can't silently disable a login method.
const providersSchema = z.object({ emailPassword: z.boolean().optional() }).strict();
const authConfigPutSchema = z.object({ providers: providersSchema });
const DEFAULT_PROVIDERS = { emailPassword: true };

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

  // ===========================================================================
  // Events (mirrors posts; `description` is the Block[] field)
  // ===========================================================================

  // GET /api/sites/:siteId/events[?status=…] — list, soonest-first (description omitted).
  router.get(
    "/sites/:siteId/events",
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
        const events = await listEvents(pool, siteId, { status });
        res.json({ events: events.map(stripEventDescription) });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/sites/:siteId/events — create an event.
  router.post(
    "/sites/:siteId/events",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = eventInputSchema.safeParse(req.body);
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
        const event = await createEvent(pool, siteId, parsed.data);
        res.status(201).json({ event });
      } catch (err) {
        if (err instanceof EventSlugConflictError) {
          res.status(409).json({ error: "an event with that slug already exists on this site" });
          return;
        }
        if (err instanceof InvalidEventDescriptionError) {
          res.status(400).json({ error: "event description failed block validation", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/events/:eventId — full event (incl. description).
  router.get(
    "/sites/:siteId/events/:eventId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, eventId } = req.params;
        const event = await getEventById(pool, siteId, eventId);
        if (!event) {
          res.status(404).json({ error: "event not found for this site" });
          return;
        }
        res.json({ event });
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /api/sites/:siteId/events/:eventId — update fields/description/status.
  router.put(
    "/sites/:siteId/events/:eventId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = eventPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload", details: zodDetails(parsed.error) });
        return;
      }
      try {
        const { siteId, eventId } = req.params;
        const event = await updateEvent(pool, siteId, eventId, parsed.data);
        if (!event) {
          res.status(404).json({ error: "event not found for this site" });
          return;
        }
        res.json({ event });
      } catch (err) {
        if (err instanceof EventSlugConflictError) {
          res.status(409).json({ error: "an event with that slug already exists on this site" });
          return;
        }
        if (err instanceof InvalidEventDescriptionError) {
          res.status(400).json({ error: "event description failed block validation", failures: err.failures });
          return;
        }
        next(err);
      }
    },
  );

  // DELETE /api/sites/:siteId/events/:eventId — remove an event.
  router.delete(
    "/sites/:siteId/events/:eventId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, eventId } = req.params;
        const deleted = await deleteEvent(pool, siteId, eventId);
        if (!deleted) {
          res.status(404).json({ error: "event not found for this site" });
          return;
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // ===========================================================================
  // Members + auth config (tenant_auth_user / tenant_auth_config)
  // ===========================================================================

  // GET /api/sites/:siteId/members — this site's member accounts (read-only).
  // tenant_auth_* columns are camelCase (Better-auth), so they're quoted.
  router.get(
    "/sites/:siteId/members",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const result = await pool.query(
          `SELECT id, name, email,
                  "emailVerified" AS email_verified,
                  "createdAt" AS created_at
             FROM tenant_auth_user
            WHERE site_id = $1
            ORDER BY "createdAt" DESC`,
          [siteId],
        );
        res.json({ members: result.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /api/sites/:siteId/members/:memberId — D423: remove a member
  // account (e.g. a spam/abusive signup). tenant_auth_session and
  // tenant_auth_account both FK userId with ON DELETE CASCADE, so this one
  // delete also drops the member's sessions (forced logout) and credential
  // rows. Site-scoped: 404 if the member isn't this site's.
  router.delete(
    "/sites/:siteId/members/:memberId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId, memberId } = req.params;
        const del = await pool.query(
          `DELETE FROM tenant_auth_user WHERE id = $1 AND site_id = $2`,
          [memberId, siteId],
        );
        if ((del.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "member not found for this site" });
          return;
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /api/sites/:siteId/auth-config — per-site login providers.
  router.get(
    "/sites/:siteId/auth-config",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { siteId } = req.params;
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const result = await pool.query<{ providers: Record<string, unknown> }>(
          `SELECT providers FROM tenant_auth_config WHERE site_id = $1`,
          [siteId],
        );
        // No row yet (site predates copy-in) → report the v1 default.
        res.json({ providers: result.rows[0]?.providers ?? DEFAULT_PROVIDERS });
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /api/sites/:siteId/auth-config — set the per-site login providers.
  router.put(
    "/sites/:siteId/auth-config",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = authConfigPutSchema.safeParse(req.body);
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
        const result = await pool.query<{ providers: Record<string, unknown> }>(
          `INSERT INTO tenant_auth_config (site_id, providers)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (site_id) DO UPDATE SET providers = EXCLUDED.providers
           RETURNING providers`,
          [siteId, JSON.stringify(parsed.data.providers)],
        );
        res.json({ providers: result.rows[0].providers });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
