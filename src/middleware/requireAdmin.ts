import type { NextFunction, Request, RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import {
  getStudioAuth,
  resolveStudioAuthMode,
  type StudioAuth,
  type StudioAuthMode,
} from "../server/auth/studio-auth.js";

/**
 * Admin gate for the Studio control hub (P8-T8.4 — D-034 / D-046).
 *
 * DUAL-MODE, in priority order — this is the anti-lock-out design:
 *   1. **Studio Better-auth session** — the primary human path once Google is
 *      live (the session cookie set on the Studio host, D-032).
 *   2. **`X-Admin-Token`** — kept as a CI / service / break-glass path (operator
 *      choice, 2026-05-26). Works whenever `ADMIN_API_TOKEN` is configured,
 *      independent of OAuth, so prod keeps working before/after the cutover.
 *   3. **Local dev auto-grant** — only in `dev` mode AND when no token is
 *      configured (D-034 "local = no auth"). The `&& no token` clause is what
 *      keeps the integration suite honest: those tests set `ADMIN_API_TOKEN`,
 *      so they still enforce the token and assert 401 without it.
 *   4. Otherwise **401**.
 *
 * Because (2) always works while `ADMIN_API_TOKEN` is set, provisioning the
 * Google secrets later can never 401 the admin surface — sessions simply start
 * working alongside the token.
 */

export type StudioUser = { id: string; email: string; name?: string | null };

declare module "express-serve-static-core" {
  interface Request {
    /** The authenticated admin: a Studio session user, the dev auto-grant user,
     *  or the service-token marker. Set by `requireAdmin`. */
    studioUser?: StudioUser;
  }
}

const DEV_USER: StudioUser = { id: "dev", email: "dev@studio.localhost", name: "Local Dev" };
const TOKEN_USER: StudioUser = {
  id: "service-token",
  email: "service@anchorcorps.com",
  name: "Service Token",
};

export type RequireAdminOptions = {
  /** Injectable for tests; defaults to the process singleton `getStudioAuth`. */
  getAuth?: () => StudioAuth | null;
  /** Injectable for tests; defaults to `resolveStudioAuthMode()`. */
  getMode?: () => StudioAuthMode;
};

export function requireAdmin(opts: RequireAdminOptions = {}): RequestHandler {
  const getAuth = opts.getAuth ?? getStudioAuth;
  const getMode = opts.getMode ?? (() => resolveStudioAuthMode());

  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Studio Better-auth session.
    const auth = getAuth();
    if (auth) {
      try {
        const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (result?.user?.id) {
          req.studioUser = {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
          };
          return next();
        }
      } catch {
        // session check failed → fall through to token / dev
      }
    }

    // 2. X-Admin-Token (CI / service / break-glass).
    const expected = process.env.ADMIN_API_TOKEN;
    if (expected && req.header("x-admin-token") === expected) {
      req.studioUser = TOKEN_USER;
      return next();
    }

    // 3. Local dev auto-grant (dev mode + no token configured).
    if (getMode() === "dev" && !expected) {
      req.studioUser = DEV_USER;
      return next();
    }

    // 4. Deny.
    res.status(401).json({ error: "unauthorized" });
  };
}
