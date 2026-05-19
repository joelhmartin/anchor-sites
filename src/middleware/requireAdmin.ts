import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Minimal admin gate for Phase 1. Compares the `X-Admin-Token` header to
 * `process.env.ADMIN_API_TOKEN`. Phase 8 (Better-auth, D-020) replaces this
 * with a real session-based admin check; until then, the editor + integration
 * tests pass an explicit token.
 *
 * If `ADMIN_API_TOKEN` is unset the gate refuses every request (401). This
 * is deliberate — the routine never silently grants admin access.
 */
export function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env.ADMIN_API_TOKEN;
    if (!expected) {
      res.status(401).json({ error: "admin token not configured" });
      return;
    }
    const provided = req.header("x-admin-token");
    if (!provided || provided !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
