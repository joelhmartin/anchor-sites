import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";

/**
 * `GET /api/me` (P8-T8.5). The Studio client's single auth probe: it runs
 * through `requireAdmin`, so it transparently reports whoever is authenticated
 * — a Google session user, the dev auto-grant user, or the service-token
 * marker — and 401s when no one is. The client uses 200/401 to decide between
 * rendering the app and bouncing to /login, independent of which auth mode is
 * active.
 */
export function meRouter(): Router {
  const router = Router();
  router.get("/api/me", requireAdmin(), (req, res) => {
    res.json({ user: req.studioUser ?? null });
  });
  return router;
}
