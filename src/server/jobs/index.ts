import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import {
  handleMediaProcessUpload,
  type MediaProcessUploadInput,
} from "./media-process-upload.js";
import {
  handleMaterializeTemplate,
  type MaterializeTemplateInput,
} from "./materialize-template.js";
import {
  handleCrmSync,
  CRM_SYNC_JOB,
  type CrmSyncInput,
} from "../crm/sync-job.js";
import {
  handleAgentTurn,
  type AgentTurnInput,
} from "./agent-turn.js";
import {
  handleGitExport,
  type GitExportInput,
} from "./git-export.js";
import { handleGitImport } from "./git-import.js";
import type { GitImportInput } from "../routes/git-webhook.js";

export const MEDIA_PROCESS_UPLOAD = "media.process-upload";
export const TEMPLATE_MATERIALIZE = "template.materialize";
export const AGENT_TURN = "ai.agent-turn";
export const GIT_EXPORT = "git.export";
export const GIT_IMPORT = "git.import";
export { CRM_SYNC_JOB };

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

  // P7-T7.5: template materialization (D-042).
  await boss.createQueue(TEMPLATE_MATERIALIZE);
  await boss.work<MaterializeTemplateInput>(TEMPLATE_MATERIALIZE, async ([job]) => {
    await handleMaterializeTemplate(job.data, { pool: defaultPool });
  });

  // P11-T11.7 (D-053): CRM sync retries.
  await boss.createQueue(CRM_SYNC_JOB);
  await boss.work<CrmSyncInput>(CRM_SYNC_JOB, async ([job]) => {
    await handleCrmSync(job.data, { pool: defaultPool });
  });

  // Task 9 (AI site agent): build-turn worker.
  //
  // Bot-review fix wave round 2, item 1 (Important — singletonKey was
  // inert): pg-boss's default queue policy is `standard`, under which
  // `singletonKey` has NO dedupe effect at all (empirically verified: two
  // `send()` calls with the same `singletonKey` against a `standard` queue
  // both return distinct job ids). `stately` is the policy that actually
  // enforces "at most one job per state (queued/active) per singletonKey" —
  // a second `send()` for a key that already has one queued or active
  // returns `null`. The policy must be set at queue-creation time (pg-boss
  // refuses to change it afterward).
  //
  // Shared explanation for all three `stately` queues below (AGENT_TURN,
  // GIT_EXPORT, GIT_IMPORT — GitHub sync fix round 1, Important): every
  // enqueue call site that relies on `singletonKey` dedup MUST treat a
  // `null` `send()` result as ambiguous — "queue genuinely down" vs. "a job
  // for this key is already queued/active" — and disambiguate before
  // reporting failure. See `admin-ai-agent.ts`'s `hasLiveAgentTurnJob` (a
  // direct `pgboss.job` existence check, since pg-boss's public API has no
  // "is a job with this singletonKey already queued/active?" query) and
  // `admin-git.ts`'s `hasLiveExportJob`, the same precedent applied to
  // GIT_EXPORT.
  await boss.createQueue(AGENT_TURN, { policy: "stately" });
  await boss.work<AgentTurnInput>(AGENT_TURN, async ([job]) => {
    await handleAgentTurn(job.data, { pool: defaultPool });
  });

  // Task 4 (GitHub sync): export-on-publish/manual worker. The handler
  // itself is the disabled-mode/enabled-state gate (mode disabled or the
  // site's git state row missing/disabled → silent no-op), so registration
  // here is unconditional — same shape as every other job above. `stately`
  // policy (fix round 1, Important — same singletonKey-is-inert-under-
  // `standard` bug as AGENT_TURN above, since AGENT_TURN's registration
  // comment): a site's `enable` (initial export) and a manual "Export now"
  // click both `send()` with `singletonKey: siteId`, so this is what
  // actually stops two GIT_EXPORT jobs for the same site from ever being
  // queued/active at once.
  await boss.createQueue(GIT_EXPORT, { policy: "stately" });
  await boss.work<GitExportInput>(GIT_EXPORT, async ([job]) => {
    await handleGitExport(job.data, { pool: defaultPool });
  });

  // Task 6 (GitHub sync): validated import worker. routes/git-webhook.ts
  // (Task 5) enqueues GitImportInput jobs here after HMAC verification +
  // loop-prevention filtering; the handler itself is the
  // disabled-mode/enabled-state/idempotency gate, so registration here is
  // unconditional — same shape as GIT_EXPORT above. `stately` policy, PLUS
  // (fix round 1, Important 3) a per-PUSH `singletonKey`:
  // `${siteId}:${headSha}` (see git-webhook.ts's enqueueImport doc), not
  // bare `siteId`. Bare `siteId` was wrong: under `stately`, a SECOND real
  // push to the same site (different content, different headSha) while the
  // first push's import job is still queued/active would `send()` with the
  // same key and get `null` back — silently dropping that push's edits
  // forever, since nothing retries a job that was never created (unlike
  // GIT_EXPORT, where every send() carries the SAME siteId-only key by
  // design — re-exporting the current DB state is idempotent regardless of
  // which trigger asked for it, so collapsing bursts to one is exactly what
  // GIT_EXPORT wants). Keying GIT_IMPORT on the pair instead keeps the
  // intended dedupe (a redelivered webhook for the SAME push collapses to
  // one job) while letting two DIFFERENT pushes to the same site both queue.
  await boss.createQueue(GIT_IMPORT, { policy: "stately" });
  await boss.work<GitImportInput>(GIT_IMPORT, async ([job]) => {
    await handleGitImport(job.data, { pool: defaultPool });
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
