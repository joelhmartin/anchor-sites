/**
 * Mount the Studio Better-auth handler (P8-T8.3 — D-034 / D-046).
 *
 * Registered in `createApp` BEFORE `express.json()` because Better-auth's
 * node handler reads the raw request body itself. Both routes are gated to the
 * Studio host (`isAdminHost`) — on any tenant host they `next()` through, so
 * tenant auth (Track B, 8.8) can own `/api/auth/*` there without colliding.
 *
 *   - `/api/auth/*`            → Better-auth (sign-in, session, sign-out, …).
 *   - `/auth/google/callback`  → forwarding shim to Better-auth's internal
 *                                `/api/auth/callback/google`, so the
 *                                operator-documented redirect URI (D-034)
 *                                works without re-registering it.
 *
 * Returns `true` if a Google handler was mounted (google mode), `false` in
 * dev/disabled mode (no instance — `requireAdmin` handles the dev session and
 * the token path instead).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { isAdminHost } from "../../config/admin-host.js";
import { getStudioAuth, STUDIO_AUTH_BASE_PATH, type StudioAuth } from "./studio-auth.js";

type RawHandler = (req: Request, res: Response) => unknown;

export function mountStudioAuth(app: Express, opts: { auth?: StudioAuth | null } = {}): boolean {
  // `undefined` → use the process singleton; explicit `null`/instance → test injection.
  const auth = opts.auth !== undefined ? opts.auth : getStudioAuth();
  if (!auth) return false;

  const handler = toNodeHandler(auth) as RawHandler;

  const studioOnly =
    (h: RawHandler) => (req: Request, res: Response, next: NextFunction) =>
      isAdminHost(req.hostname) ? void h(req, res) : next();

  app.all(
    "/auth/google/callback",
    studioOnly((req, res) => {
      req.url = req.url.replace("/auth/google/callback", `${STUDIO_AUTH_BASE_PATH}/callback/google`);
      return handler(req, res);
    }),
  );

  app.all(`${STUDIO_AUTH_BASE_PATH}/*`, studioOnly(handler));

  return true;
}
