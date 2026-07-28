import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { resolveGitMode } from "../git/client.js";
import { getGitState, setGitEnabled } from "../git/state-repo.js";
import { GIT_EXPORT } from "../jobs/index.js";
import type { GitExportInput } from "../jobs/git-export.js";

/**
 * Admin GitHub-sync API (GitHub Sync plan, Task 7). Studio's `GitCard`
 * (src/admin/pages/site-tabs/GitCard.tsx) is the sole consumer.
 *
 *   GET  /api/sites/:siteId/git        → { configured, repo, state }
 *   POST /api/sites/:siteId/git/enable → body { enabled }; upserts
 *     site_git_state; enabling ALSO enqueues an "initial" export.
 *   POST /api/sites/:siteId/git/export → 409 unless already enabled;
 *     enqueues a "manual" export.
 *
 * `configured` reflects the SERVER's mode (`resolveGitMode(env)`), which is
 * independent of any one site's `enabled` flag — a site can be enabled in
 * its state row while the server-wide token/repo aren't configured (e.g.
 * disabled mid-rollout); the export job itself re-checks both gates
 * (src/server/jobs/git-export.ts), so this route never has to.
 */

export type AdminGitOptions = {
  pool?: Pool;
  /**
   * Injectable for tests. Default: lazy `getBoss().send(GIT_EXPORT, input,
   * { singletonKey: siteId })` (media.ts / git-webhook.ts precedent),
   * swallowing pg-boss failures to `null` — callers below turn a `null`
   * into an honest 503 rather than lying with a 202.
   */
  enqueueExport?: (input: GitExportInput) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  rateLimit?: RateLimitOptions;
};

const enablePayload = z.object({ enabled: z.boolean() });

function invalidPayload(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: "invalid payload",
    details: error.errors.map((e) => ({
      path: e.path.join(".") || "(root)",
      message: e.message,
    })),
  });
}

export function adminGitRouter(opts: AdminGitOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const env = opts.env ?? process.env;
  const router = Router();
  const admin = requireAdmin();
  const limiter = rateLimit(opts.rateLimit ?? { max: 10, windowMs: 60_000 });

  const enqueueExport: (input: GitExportInput) => Promise<string | null> =
    opts.enqueueExport ??
    (async (input) => {
      try {
        const { getBoss } = await import("../jobs/index.js");
        return await getBoss().send(GIT_EXPORT, input, { singletonKey: input.siteId });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[git] pg-boss enqueue failed", err);
        return null;
      }
    });

  async function siteExists(siteId: string): Promise<boolean> {
    const r = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---------------------------------------------------------------------
  // GET /sites/:siteId/git
  // ---------------------------------------------------------------------
  router.get(
    "/sites/:siteId/git",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;
      try {
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const configured = resolveGitMode(env) === "api";
        const state = await getGitState(pool, siteId);
        res.status(200).json({
          configured,
          repo: configured ? (env.GITHUB_CONTENT_REPO ?? null) : null,
          state,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // POST /sites/:siteId/git/enable — body { enabled }
  // ---------------------------------------------------------------------
  router.post(
    "/sites/:siteId/git/enable",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;
      const parsed = enablePayload.safeParse(req.body);
      if (!parsed.success) {
        invalidPayload(res, parsed.error);
        return;
      }
      try {
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const state = await setGitEnabled(pool, siteId, parsed.data.enabled);

        if (parsed.data.enabled) {
          const jobId = await enqueueExport({ siteId, trigger: "initial" });
          if (!jobId) {
            // Don't lie about success when the initial export silently
            // failed to queue — the state row is already flipped to
            // enabled (a retry of this same POST is safe: setGitEnabled is
            // an upsert, and a second enqueue attempt is exactly what's
            // needed here), so there's nothing to unwind.
            // eslint-disable-next-line no-console
            console.error("[git] enable enqueue returned no id — reporting 503", { siteId });
            res.status(503).json({ error: "job queue unavailable" });
            return;
          }
        }

        res.status(200).json({ state });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // POST /sites/:siteId/git/export
  // ---------------------------------------------------------------------
  router.post(
    "/sites/:siteId/git/export",
    admin,
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      const { siteId } = req.params;
      try {
        if (!(await siteExists(siteId))) {
          res.status(404).json({ error: "site not found" });
          return;
        }
        const state = await getGitState(pool, siteId);
        if (!state?.enabled) {
          res.status(409).json({ error: "git not enabled" });
          return;
        }

        const jobId = await enqueueExport({ siteId, trigger: "manual" });
        if (!jobId) {
          // eslint-disable-next-line no-console
          console.error("[git] export enqueue returned no id — reporting 503", { siteId });
          res.status(503).json({ error: "job queue unavailable" });
          return;
        }

        res.status(202).json({ queued: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
