import type { NextFunction, Request, Response } from "express";
import { isAdminHost } from "../config/admin-host.js";

/**
 * Tag the request when it targets the Studio control hub (D-032), so tenant
 * routes (page renderer, blog/events, sitemap) can fall through with `next()`
 * instead of serving tenant content on the admin host. Shared by every router
 * that mounts before the catch-all so the guard lives in exactly one place.
 */
export function flagAdminHost(req: Request, _res: Response, next: NextFunction): void {
  if (isAdminHost(req.headers.host)) req.isAdminHost = true;
  next();
}
