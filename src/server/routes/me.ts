import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { resolveStudioAuthMode } from "../auth/studio-auth.js";

/**
 * `GET /api/me` (P8-T8.5). The Studio client's single auth probe: it runs
 * through `requireAdmin`, so it transparently reports whoever is authenticated
 * — a Google session user, the dev auto-grant user, or the service-token
 * marker — and 401s when no one is. The client uses 200/401 to decide between
 * rendering the app and bouncing to /login, independent of which auth mode is
 * active.
 *
 * `GET /api/auth-mode` (D814) — tiny UNAUTHENTICATED discovery endpoint so
 * LoginPage only offers sign-in methods this deployment can honor (a
 * `disabled`/`dev` deployment renders no Google button instead of failing
 * post-click with OAuth jargon). Deliberately public: the mode is not a
 * secret — it's fully observable anyway (the sign-in endpoint either exists
 * or it doesn't), and the response carries nothing else.
 */
export function meRouter(): Router {
  const router = Router();
  router.get("/api/me", requireAdmin(), (req, res) => {
    res.json({ user: req.studioUser ?? null });
  });
  router.get("/api/auth-mode", (_req, res) => {
    res.json({ mode: resolveStudioAuthMode() });
  });
  return router;
}
