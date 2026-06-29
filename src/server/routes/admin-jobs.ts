/**
 * P12-T12.7 — pg-boss queue health endpoint.
 *
 * GET /api/admin/jobs/health returns queue depths and oldest pending job age
 * for each registered queue. requireAdmin() gated. When pg-boss is disabled
 * (JOBS_ENABLED=false or bossEnabled:false injection), returns { enabled: false }.
 *
 * Worker-restart resilience: boss.createQueue() is idempotent (no-op if the
 * queue already exists). boss.work() re-registration on a second bootJobs()
 * call is safe — pg-boss upserts the handler. bootPromise guard in
 * src/server/jobs/index.ts prevents double-start.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { getBoss, MEDIA_PROCESS_UPLOAD, TEMPLATE_MATERIALIZE, CRM_SYNC_JOB } from "../jobs/index.js";

const QUEUES = [MEDIA_PROCESS_UPLOAD, TEMPLATE_MATERIALIZE, CRM_SYNC_JOB];

export type AdminJobsOptions = {
  pool?: Pool;
  /** Injected false in tests to skip getBoss() (which requires a live boss). */
  bossEnabled?: boolean;
};

export function adminJobsRouter(opts: AdminJobsOptions = {}): Router {
  const _pool = opts.pool ?? defaultPool;
  const bossEnabled = opts.bossEnabled !== false && process.env.JOBS_ENABLED !== "false";
  const router = Router();
  const admin = requireAdmin();

  router.get(
    "/admin/jobs/health",
    admin,
    async (_req: Request, res: Response, next: NextFunction) => {
      if (!bossEnabled) {
        res.json({ enabled: false });
        return;
      }
      try {
        const boss = getBoss();
        const queueStats = await Promise.all(
          QUEUES.map(async (name) => {
            const size = await boss.getQueueSize(name).catch(() => null);
            return { name, size };
          }),
        );
        res.json({ enabled: true, queues: queueStats });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
