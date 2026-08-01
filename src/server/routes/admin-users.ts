import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";

/**
 * Studio user administration — D522 (W2-TERM): the offboarding path admin
 * identities never had. The team gate (studio-auth.ts) runs at every sign-in
 * (D804), so removing someone from `ADMIN_ALLOWED_EMAILS` stops their FUTURE
 * sign-ins — but their `auth_user` row and any LIVE `auth_session` rows
 * persisted until token expiry, with no operator kill switch. An offboarded
 * employee's open tab kept working.
 *
 * Deleting the `auth_user` row cascades (ON DELETE CASCADE, see
 * db/migrations/1747577000000_auth_studio.cjs) to `auth_session` and
 * `auth_account`, so it revokes every live session immediately AND drops the
 * stored OAuth tokens at rest. Text ids (Better-auth), so no uuid coercion.
 *
 * All routes gated by `requireAdmin` (per-route, so unmatched /api paths still
 * fall through to the JSON 404, not 401).
 */
export function adminUsersRouter(opts: { pool?: Pool } = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const router = Router();
  const admin = requireAdmin();

  // GET /api/admin/users — Studio team roster with each user's live-session
  // count, so an operator can see who to offboard.
  router.get(
    "/admin/users",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await pool.query(
          `SELECT u.id, u.name, u.email, u."emailVerified" AS email_verified, u."createdAt" AS created_at,
                  COUNT(s.id) FILTER (WHERE s."expiresAt" > now())::int AS active_sessions
             FROM auth_user u
             LEFT JOIN auth_session s ON s."userId" = u.id
            GROUP BY u.id
            ORDER BY u."createdAt" ASC`,
        );
        res.json({ users: result.rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /api/admin/users/:userId — offboard a Studio user. CASCADE revokes
  // their sessions + accounts. Refuses to delete the caller's own row (a
  // self-lockout foot-gun mid-request); a service-token caller has no real
  // user id so that guard is a no-op for it.
  router.delete(
    "/admin/users/:userId",
    admin,
    async (req: Request, res: Response, next: NextFunction) => {
      const { userId } = req.params;
      if (req.studioUser?.id && req.studioUser.id === userId) {
        res.status(400).json({ error: "you can’t offboard your own account" });
        return;
      }
      try {
        const del = await pool.query<{ id: string; email: string }>(
          `DELETE FROM auth_user WHERE id = $1 RETURNING id, email`,
          [userId],
        );
        if (del.rowCount === 0) {
          res.status(404).json({ error: "user not found" });
          return;
        }
        res.json({ deleted: del.rows[0] });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
