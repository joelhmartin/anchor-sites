/**
 * Jobs-health endpoint (P12-T12.7, rebuilt for D606/D114/D1009/D126/D622/D1026).
 *
 * GET /api/jobs/health (canonical) — also served at the legacy
 * /api/admin/jobs/health path for back-compat (D126: /api/admin/* was the
 * lone `/api/admin/*` grammar outlier in the product; the canonical path
 * aligns with every sibling `/api/<resource>` route while the old path keeps
 * any bookmarked link working). requireAdmin() gated.
 *
 * Reports, for EVERY registered queue (D606/D114/D1009 — the old endpoint
 * hard-coded 4 of 7 work queues, hiding site.provision/git.export/git.import
 * and returning only a single queuedCount):
 *   - per-state counts: active / queued (created) / retry / failed / completed
 *   - the oldest pending job's age in seconds (created + retry), so a stuck
 *     backlog is visible, not just a depth
 * plus the jobs-runner liveness (D1026) and the last pg-boss supervisor-loop
 * error (D622), so a down runner or a dying maintenance loop is visible from
 * the product instead of only from Cloud Logging / SQL.
 *
 * Counts come from ONE GROUP BY against pgboss.job (the parent partition,
 * which aggregates every per-queue child table). When the pgboss schema
 * doesn't exist yet (jobs never booted in this process — dev/test without a
 * boot), the query throws and we report null counts rather than 500ing: the
 * runner state already tells the caller why.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import {
  ALL_QUEUE_NAMES,
  getJobsRunnerState,
  getLastBossError,
  type JobsRunnerState,
  type BossErrorRecord,
} from "../jobs/index.js";

/** One row per (queue, state) from the GROUP BY. */
export type JobCountRow = {
  name: string;
  state: string;
  count: number;
  oldest_age_seconds: number | null;
};

export type QueueHealth = {
  name: string;
  active: number;
  queued: number;
  retry: number;
  failed: number;
  completed: number;
  /** Age (seconds) of the oldest not-yet-run job (created + retry), or null. */
  oldestPendingAgeSeconds: number | null;
};

export type AdminJobsOptions = {
  pool?: Pool;
  /**
   * Injected false in tests to skip the counts query when there's no live
   * pg-boss schema. Defaults to reading the real runner state (a down/disabled
   * runner still returns null counts honestly rather than erroring).
   */
  bossEnabled?: boolean;
  /** Injectable for tests — defaults to the pgboss.job GROUP BY. */
  loadJobCounts?: (pool: Pool, names: readonly string[]) => Promise<JobCountRow[]>;
  /** Injectable for tests — defaults to the module runner state. */
  runnerState?: () => JobsRunnerState;
  /** Injectable for tests — defaults to the module last-boss-error. */
  lastBossError?: () => BossErrorRecord | null;
};

async function defaultLoadJobCounts(
  pool: Pool,
  names: readonly string[],
): Promise<JobCountRow[]> {
  const r = await pool.query<JobCountRow>(
    `SELECT name,
            state::text AS state,
            count(*)::int AS count,
            CASE WHEN state IN ('created', 'retry')
                 THEN EXTRACT(EPOCH FROM (now() - min(created_on)))::int
                 ELSE NULL END AS oldest_age_seconds
       FROM pgboss.job
      WHERE name = ANY($1::text[])
      GROUP BY name, state`,
    [names as string[]],
  );
  return r.rows;
}

function shapeQueues(names: readonly string[], rows: JobCountRow[] | null): QueueHealth[] {
  const byName = new Map<string, JobCountRow[]>();
  for (const row of rows ?? []) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  return names.map((name) => {
    const rowsForQueue = byName.get(name) ?? [];
    const stateCount = (state: string): number =>
      rowsForQueue.find((r) => r.state === state)?.count ?? 0;
    const created = stateCount("created");
    const retry = stateCount("retry");
    const pendingAges = rowsForQueue
      .filter((r) => (r.state === "created" || r.state === "retry") && r.oldest_age_seconds != null)
      .map((r) => r.oldest_age_seconds as number);
    return {
      name,
      active: stateCount("active"),
      queued: created,
      retry,
      failed: stateCount("failed"),
      completed: stateCount("completed"),
      oldestPendingAgeSeconds: pendingAges.length > 0 ? Math.max(...pendingAges) : null,
    };
  });
}

export function adminJobsRouter(opts: AdminJobsOptions = {}): Router {
  const _pool = opts.pool ?? defaultPool;
  const bossEnabled =
    opts.bossEnabled !== false && process.env.JOBS_ENABLED !== "false";
  const loadJobCounts = opts.loadJobCounts ?? defaultLoadJobCounts;
  const runnerState = opts.runnerState ?? getJobsRunnerState;
  const lastBossError = opts.lastBossError ?? getLastBossError;

  const router = Router();
  const admin = requireAdmin();

  const handler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runner = runnerState();
      let rows: JobCountRow[] | null = null;
      if (bossEnabled) {
        // Tolerate a missing pgboss schema / query failure: null counts, but
        // still report runner + error state so the surface is never blank.
        rows = await loadJobCounts(_pool, ALL_QUEUE_NAMES).catch(() => null);
      }
      res.json({
        enabled: runner.status === "up",
        runner,
        lastBossError: lastBossError(),
        queues: shapeQueues(ALL_QUEUE_NAMES, rows),
      });
    } catch (err) {
      next(err);
    }
  };

  // Canonical + legacy alias (D126). Same handler, same admin gate.
  router.get("/jobs/health", admin, handler);
  router.get("/admin/jobs/health", admin, handler);

  return router;
}
