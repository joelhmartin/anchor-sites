import type { RequestHandler } from "express";

/**
 * Per-site plugin enablement guard (P7.5-T7.5.7, D-045).
 *
 * Plugin routers are mounted ONCE globally at `/api/plugins/<name>`; the loader
 * runs `resolveSite` (pass-through) ahead of them so `req.site` is populated for
 * tenant-host requests. A plugin guards its routes with this middleware so a
 * route only serves sites that have the plugin enabled (`req.site.plugins`).
 *
 *   - no resolved site (non-tenant host / unknown host) → 404
 *   - site resolved but plugin not enabled for it        → 403
 */
export function requireSitePlugin(pluginName: string): RequestHandler {
  return (req, res, next) => {
    if (!req.site) {
      res.status(404).json({ error: "site not resolved for this host" });
      return;
    }
    if (!req.site.plugins.some((p) => p.name === pluginName)) {
      res.status(403).json({ error: `plugin "${pluginName}" is not enabled for this site` });
      return;
    }
    next();
  };
}
