import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import {
  handleMediaProcessUpload,
  type MediaProcessUploadInput,
} from "./media-process-upload.js";

export const MEDIA_PROCESS_UPLOAD = "media.process-upload";

/**
 * pg-boss bootstrap (D-030, P3-T3.8).
 *
 * Lifecycle:
 *   - `bootJobs(pool, opts)` starts pg-boss against the same DATABASE_URL
 *     the renderer uses, creates the `pgboss.*` schema lazily, registers
 *     every job handler we know about, and returns a `JobBoot` handle.
 *   - The same Express process is the worker by default. Set
 *     `JOBS_ENABLED=false` to skip booting (tests, one-off scripts).
 *   - `getBoss()` returns the running instance for enqueueing — throws if
 *     `bootJobs` hasn't completed (or `JOBS_ENABLED=false` was set).
 *   - `stopJobs()` cleanly shuts down. Idempotent.
 *
 * Job handlers are registered HERE (not auto-discovered) so the boot
 * sequence is one greppable list. New jobs add their import + a
 * `boss.work(...)` call inside `registerHandlers`.
 *
 * Connection: pg-boss owns its own pool internally. We pass the existing
 * `Pool`'s connection string so it picks up the same DB env. Sharing the
 * actual pool with pg-boss is supported but couples lifetimes — separate
 * pool is the safer default.
 */

export type JobBoot = {
  boss: PgBoss;
  stop: () => Promise<void>;
};

let bootPromise: Promise<JobBoot> | null = null;
let bossInstance: PgBoss | null = null;

export type BootJobsOptions = {
  /**
   * Skip starting pg-boss. Tests can also flip `JOBS_ENABLED=false`
   * via env. Default false (jobs run).
   */
  disable?: boolean;
  /**
   * Override the connection string. Defaults to `DATABASE_URL`.
   */
  connectionString?: string;
  /**
   * Hook for tests to register additional handlers alongside the
   * built-in ones. Called once after start, before resolving the boot
   * promise.
   */
  extraHandlers?: (boss: PgBoss) => Promise<void> | void;
};

export async function bootJobs(
  pool: Pool,
  opts: BootJobsOptions = {},
): Promise<JobBoot> {
  if (opts.disable || process.env.JOBS_ENABLED === "false") {
    // Construct a no-op handle so callers don't have to branch.
    const noop: JobBoot = {
      boss: undefined as unknown as PgBoss,
      stop: async () => {},
    };
    return noop;
  }
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const connectionString =
      opts.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("bootJobs: DATABASE_URL required");
    }

    const boss = new PgBoss({ connectionString });
    boss.on("error", (err) => {
      // Avoid crashing the process on transient errors. Real handlers
      // will surface failures via their own retry/dead-letter logic.
      // eslint-disable-next-line no-console
      console.error("[pg-boss] error", err);
    });
    await boss.start();
    bossInstance = boss;

    await registerHandlers(boss);
    if (opts.extraHandlers) {
      await opts.extraHandlers(boss);
    }

    const stop = async (): Promise<void> => {
      if (!bossInstance) return;
      try {
        await bossInstance.stop({ graceful: true });
      } finally {
        bossInstance = null;
        bootPromise = null;
      }
    };

    return { boss, stop };
  })();

  return bootPromise;
}

export function getBoss(): PgBoss {
  if (!bossInstance) {
    throw new Error(
      "pg-boss not started — bootJobs() must run first (or JOBS_ENABLED=false)",
    );
  }
  return bossInstance;
}

export async function stopJobs(): Promise<void> {
  if (!bossInstance) return;
  const boot = await bootPromise;
  await boot?.stop();
}

/**
 * Register every job handler the worker should listen for. New jobs add
 * their import + `boss.work(...)` here.
 *
 * Phase 3 has no real handlers yet — `media.process-upload` lands in
 * Task 3.10. The empty function is intentional so the boot path is
 * exercised end-to-end before any real workload.
 */
async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.createQueue(MEDIA_PROCESS_UPLOAD);
  await boss.work<MediaProcessUploadInput>(MEDIA_PROCESS_UPLOAD, async ([job]) => {
    await handleMediaProcessUpload(job.data, { pool: defaultPool });
  });
}

/**
 * Test-only escape hatch. Resets module state so a subsequent
 * `bootJobs` starts fresh. DO NOT call from production code.
 */
export function __resetJobsForTests(): void {
  bossInstance = null;
  bootPromise = null;
}
