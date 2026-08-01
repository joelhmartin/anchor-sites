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
  AGENT_TURN_EXPIRE_SECONDS,
  type AgentTurnInput,
} from "./agent-turn.js";
import {
  handleGitExport,
  type GitExportInput,
} from "./git-export.js";
import { handleGitImport } from "./git-import.js";
import type { GitImportInput } from "../routes/git-webhook.js";
import {
  handleSiteProvision,
  type SiteProvisionInput,
} from "./site-provision.js";
import { pruneExpiredAuthRows } from "./auth-prune.js";
import { DOMAIN_VERIFY_SWEEP, sweepPendingDomains } from "./domain-verify-sweep.js";
import {
  MEDIA_PENDING_SWEEP,
  MEDIA_ORPHAN_SWEEP,
  sweepAbandonedUploads,
  sweepOrphanAssets,
} from "./media-gc.js";

export const MEDIA_PROCESS_UPLOAD = "media.process-upload";
export const TEMPLATE_MATERIALIZE = "template.materialize";
export const AGENT_TURN = "ai.agent-turn";
export const GIT_EXPORT = "git.export";
export const GIT_IMPORT = "git.import";
export const SITE_PROVISION = "site.provision";
export const AUTH_PRUNE = "auth.prune-expired";
export { CRM_SYNC_JOB };
export { DOMAIN_VERIFY_SWEEP };
export { MEDIA_PENDING_SWEEP, MEDIA_ORPHAN_SWEEP };

/**
 * D606/D114/D1009 (W2-JOBS) — the canonical list of every queue this worker
 * registers, in one place. The jobs-health endpoint (routes/admin-jobs.ts)
 * imports THIS instead of hard-coding its own subset: the old endpoint listed
 * 4 of 7 work queues (GIT_EXPORT, GIT_IMPORT, SITE_PROVISION were invisible —
 * and site.provision is the queue whose backlog most directly breaks the
 * new-site flow). Keep this in lockstep with `registerHandlers` below: every
 * `createQueue` call there has an entry here (the jobs-registration test pins
 * that they don't drift). Ordered by product prominence, not alphabetically.
 */
export const ALL_QUEUE_NAMES = [
  SITE_PROVISION,
  TEMPLATE_MATERIALIZE,
  AGENT_TURN,
  GIT_EXPORT,
  GIT_IMPORT,
  MEDIA_PROCESS_UPLOAD,
  CRM_SYNC_JOB,
  AUTH_PRUNE,
  DOMAIN_VERIFY_SWEEP,
  MEDIA_PENDING_SWEEP,
  MEDIA_ORPHAN_SWEEP,
] as const;

/**
 * W2-CONC / D618 — git-export contention backoff. Exports for DIFFERENT
 * sites all contend on ONE branch ref (`updateRef` on the shared content
 * repo); the loser of a concurrent update fails as non-fast-forward and used
 * to get only pg-boss's default 2 IMMEDIATE retries — losing the same race
 * twice in a row dropped the export into invisible `failed`. Contention is
 * transient by nature, so the fix is time, not luck: 5 retries on an
 * exponential backoff (15s base, capped at 5 min ≈ up to ~10 min of total
 * coverage), enough for even a burst of publishes to serialize through the
 * ref. The export handler is a no-op when the repo already matches
 * (blob-sha comparison), so a retry that lost its purpose costs one skipped
 * job.
 *
 * Applied BOTH at createQueue (fresh installs) AND per-send at every
 * GIT_EXPORT send site — pg-boss's create_queue is ON CONFLICT DO NOTHING,
 * so queue-level options never update an existing deployment's queue row
 * (same reason AGENT_TURN carries expireInSeconds per send).
 */
export const GIT_EXPORT_RETRY_OPTIONS = {
  retryLimit: 5,
  retryDelay: 15,
  retryBackoff: true,
  retryDelayMax: 300,
} as const;

/**
 * W2-CONC / D617 — SITE_PROVISION worker concurrency. Each provision attempt
 * intentionally holds up to 4 minutes (PROVISION_WAIT_TIMEOUT_MS: the
 * bounded Cloud Run mapping/cert poll), and the default single worker slot
 * serialized an N-site burst into ~4N minutes of preview-URL latency.
 * 3 concurrent workers per node: enough to keep a realistic burst (template
 * gallery demos, onboarding batches) from stacking, small enough that the
 * held Cloud Run polls + GoDaddy/Kinsta/Cloud Run API rate limits (Kinsta
 * caps ~5 record creates/min) aren't hammered by a thundering herd. Safe to
 * parallelize: provisioning is idempotent per-domain and each domain row has
 * its own stately singletonKey, so no two workers ever hold the same domain.
 */
export const SITE_PROVISION_LOCAL_CONCURRENCY = 3;

/**
 * D603 (W2-JOBS) — git.import retry policy. GIT_IMPORT was created with a
 * policy only and enqueued with NO retry options, so it inherited pg-boss's
 * defaults: 2 IMMEDIATE retries, zero delay, no backoff — exactly wrong for
 * the GitHub 5xx / network blips this fetch-heavy job hits (each imported
 * file is a `getFileAtRef` API call). After exhausting two instant retries a
 * transient GitHub hiccup dropped the whole push into invisible `failed`
 * with no re-drive path (recovery was "push a dummy commit"). Give it the
 * same deliberate backoff shape as GIT_EXPORT (5 retries, 15s base,
 * exponential, capped at 5 min ≈ ~10 min coverage) — the import handler is
 * idempotent (last_import_sha gate + per-file revisions), so a retry that
 * re-runs unchanged content is a harmless no-op.
 *
 * Applied BOTH at createQueue AND per-send (the webhook enqueue), since
 * pg-boss's create_queue is ON CONFLICT DO NOTHING and never updates an
 * existing deployment's queue row.
 */
export const GIT_IMPORT_RETRY_OPTIONS = {
  retryLimit: 5,
  retryDelay: 15,
  retryBackoff: true,
  retryDelayMax: 300,
} as const;

/**
 * D615 (W2-JOBS) — media.process-upload retry policy. The handler's own doc
 * comment CLAIMED "pg-boss retries via its built-in backoff", but the queue
 * was created with no options, so it inherited the default: 2 IMMEDIATE
 * retries, zero delay, no backoff — the comment was false armor. The handler
 * downloads the original from GCS and runs sharp; a transient GCS blip
 * benefits from a short backoff rather than two instant re-hammers. 3
 * retries, 10s base, exponential — the handler is idempotent (content-hashed
 * variant keys overwrite identical bytes), so a retry never corrupts output.
 *
 * NOTE — deliberately NO stately singletonKey on this queue (the audit's
 * D615 fix-class suggested `singletonKey: asset_id`). That would DEFEAT D604:
 * the media.ts /complete route re-enqueues a stale-'processing' asset whose
 * worker died, and under stately a singletonKey=asset_id send would return
 * null (dedupe) against the dead worker's not-yet-expired 'active' job,
 * silently dropping the recovery. The idempotent handler makes the
 * dedupe's value marginal anyway (a racing double-/complete just processes
 * identical bytes twice), so recovery wins over dedupe here.
 */
export const MEDIA_PROCESS_RETRY_OPTIONS = {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
} as const;

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

/**
 * D1026 (W2-JOBS) — jobs-runner liveness, queryable from health surfaces.
 *
 * Before this, `bootJobs` failure logged "continuing without job runner"
 * exactly once, then every subsequent enqueue silently returned `null`
 * through scattered try/catch while `/healthz` still reported `ok`. The
 * runner state is now module state that `/healthz` (app.ts) and the
 * jobs-health endpoint (routes/admin-jobs.ts) both read:
 *   - "up"       — bootJobs completed and handlers registered.
 *   - "down"     — a boot attempt threw (the failure detail rides in
 *                  `error`), or pg-boss reported a fatal error. This is the
 *                  ONLY state that degrades /healthz's `ok`.
 *   - "disabled" — no active runner and not a failure: JOBS_ENABLED=false /
 *                  opts.disable, OR simply "boot not attempted in this
 *                  process" (e.g. an integration test's createApp() that
 *                  never calls bootJobs). Benign — /healthz stays ok.
 */
export type JobsRunnerStatus = "up" | "down" | "disabled";
export type JobsRunnerState = {
  status: JobsRunnerStatus;
  error: string | null;
  /** When the current state was entered (ISO). */
  since: string;
};

/**
 * D622 (W2-JOBS) — last pg-boss supervisor-loop error, queryable from the
 * jobs-health endpoint. `boss.on("error")` fires when pg-boss's own
 * maintenance loop (the thing that runs retries + expirations) hiccups; a
 * bare console.error made a dying maintenance loop indistinguishable from a
 * quiet day except by reading Cloud Logging.
 */
export type BossErrorRecord = { message: string; at: string };

let bootPromise: Promise<JobBoot> | null = null;
let bossInstance: PgBoss | null = null;
let runnerState: JobsRunnerState = { status: "disabled", error: null, since: new Date().toISOString() };
let lastBossError: BossErrorRecord | null = null;

function setRunnerState(status: JobsRunnerStatus, error: string | null = null): void {
  runnerState = { status, error, since: new Date().toISOString() };
}

/** D1026: current jobs-runner liveness (read by /healthz + jobs-health). */
export function getJobsRunnerState(): JobsRunnerState {
  return runnerState;
}

/**
 * D1026: record that the job runner failed to start. Called by index.ts's
 * boot try/catch — bootJobs itself resolves a no-op handle on `disable`, but
 * a genuine start() throw propagates to the caller, which must mark the
 * runner down so health surfaces stop lying.
 */
export function markJobsRunnerFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  setRunnerState("down", message);
}

/** D622: most recent pg-boss supervisor-loop error, or null. */
export function getLastBossError(): BossErrorRecord | null {
  return lastBossError;
}

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
    // D1026: a deliberate no-op boot is "disabled", not "down" — health
    // surfaces distinguish "we chose not to run jobs here" from "the runner
    // fell over".
    setRunnerState("disabled");
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
      // D622: persist the supervisor-loop error so it's queryable from the
      // jobs-health endpoint, not only from Cloud Logging. Still avoid
      // crashing the process on transient errors — real handlers surface
      // their own failures via retry/dead-letter logic.
      lastBossError = {
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      // eslint-disable-next-line no-console
      console.error("[pg-boss] error", err);
    });
    await boss.start();
    bossInstance = boss;

    await registerHandlers(boss);
    if (opts.extraHandlers) {
      await opts.extraHandlers(boss);
    }

    // D1026: handlers registered — the runner is live.
    setRunnerState("up");

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
 * Exported ONLY so tests can assert queue/worker registration options
 * (policy, retry ladder, concurrency) against a stub boss — production code
 * must never call this outside `bootJobs`.
 */
export async function registerHandlers(boss: PgBoss): Promise<void> {
  // D615: explicit retry-with-backoff (see MEDIA_PROCESS_RETRY_OPTIONS's doc
  // — the handler's old "built-in backoff" comment was false). No stately
  // singletonKey by design (it would fight D604's stuck-state recovery).
  await boss.createQueue(MEDIA_PROCESS_UPLOAD, { ...MEDIA_PROCESS_RETRY_OPTIONS });
  await boss.work<MediaProcessUploadInput>(MEDIA_PROCESS_UPLOAD, async ([job]) => {
    await handleMediaProcessUpload(job.data, { pool: defaultPool });
  });

  // P7-T7.5: template materialization (D-042).
  // D605: `stately` policy — the from-template + re-materialize routes both
  // send() with `singletonKey: ${siteId}:${templateId}`, but `singletonKey`
  // is INERT under the default `standard` policy (the same bug already fixed
  // for AGENT_TURN/GIT_EXPORT/GIT_IMPORT/SITE_PROVISION was missed on this
  // fifth queue), so a double-submit queued duplicate materializations. Under
  // stately, a second send for a key already queued/active dedupes to null;
  // the handler is ON-CONFLICT idempotent regardless, so this is belt +
  // braces. A COMPLETED prior job doesn't block, so a deliberate
  // re-materialize (after a failure) still queues a fresh job.
  await boss.createQueue(TEMPLATE_MATERIALIZE, { policy: "stately" });
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
  // `expireInSeconds` (W1.4 / D614): a build round can legitimately outlive
  // pg-boss's 15-min default expiry (30 tool calls × model round-trips).
  // NOTE createQueue is ON CONFLICT DO NOTHING — this option only lands on
  // FRESH databases; existing deployments are covered by the per-send
  // `expireInSeconds` on both AGENT_TURN send sites (admin-ai-agent.ts and
  // agent-turn.ts's defaultEnqueueContinuation), which overrides the queue
  // default per job unconditionally.
  await boss.createQueue(AGENT_TURN, { policy: "stately", expireInSeconds: AGENT_TURN_EXPIRE_SECONDS });
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
  // D618: retry-with-backoff for branch-ref contention — see
  // GIT_EXPORT_RETRY_OPTIONS's doc (also applied per-send at the enqueue
  // sites, since createQueue options never reach an existing deployment).
  await boss.createQueue(GIT_EXPORT, { policy: "stately", ...GIT_EXPORT_RETRY_OPTIONS });
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
  // D603: retry-with-backoff for GitHub 5xx/network blips — see
  // GIT_IMPORT_RETRY_OPTIONS's doc (also applied per-send at the webhook
  // enqueue, since createQueue options never reach an existing deployment).
  await boss.createQueue(GIT_IMPORT, { policy: "stately", ...GIT_IMPORT_RETRY_OPTIONS });
  await boss.work<GitImportInput>(GIT_IMPORT, async ([job]) => {
    await handleGitImport(job.data, { pool: defaultPool });
  });

  // Task D1 (Lovable-workspace): auto-provision a site's canonical
  // *.sites.anchorcorps.com hostname (Cloud Run mapping + DNS) right after
  // creation, so the preview URL comes up without an operator visiting the
  // Domains tab. `stately` + `singletonKey: domainId` (set by the enqueue
  // call site in sites/create-site.ts) — same rationale as AGENT_TURN/
  // GIT_EXPORT/GIT_IMPORT above: `standard` policy makes `singletonKey` a
  // no-op, and a domain row only ever wants one provision attempt
  // queued/active at a time (a retry after a Webmaster Central fix, or the
  // manual "Provision" button, should collapse into whichever attempt is
  // already in flight rather than queuing a second one).
  // D617: 3 concurrent provision workers per node (each attempt can hold up
  // to 4 minutes) — see SITE_PROVISION_LOCAL_CONCURRENCY's doc for the bound's
  // rationale. Each worker still fetches jobs one at a time (batchSize 1), so
  // one failing provision never poisons another's delivery.
  await boss.createQueue(SITE_PROVISION, { policy: "stately" });
  await boss.work<SiteProvisionInput>(
    SITE_PROVISION,
    { localConcurrency: SITE_PROVISION_LOCAL_CONCURRENCY },
    async ([job]) => {
      await handleSiteProvision(job.data, { pool: defaultPool });
    },
  );

  // D805 (W2-AUTH): daily sweep of expired auth_session / auth_verification
  // rows (studio + tenant tables) — see auth-prune.ts for why they otherwise
  // accrete forever. A pg-boss cron schedule is the least machinery that
  // actually runs, GIVEN the W1.4 `--min-instances=1` change (the always-on
  // instance is the worker; before W1.4 a scale-to-zero service could sleep
  // through every tick). `schedule()` upserts, so re-running on every boot is
  // idempotent. 04:40 UTC = overnight for the US-based team, off the busy
  // hours of the odd-hours cloud routines.
  await boss.createQueue(AUTH_PRUNE);
  await boss.work(AUTH_PRUNE, async () => {
    const counts = await pruneExpiredAuthRows(defaultPool);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log("[auth-prune] removed expired auth rows", counts);
    }
  });
  await boss.schedule(AUTH_PRUNE, "40 4 * * *", undefined, { tz: "UTC" });

  // D515 (W2-DOM): automatic re-verification of stale-pending domains.
  // Rows pending with no status write for >1h get an authoritative Cloud
  // Run re-check (verified/active on success, honest 'failed' when the
  // mapping is missing — see domain-verify-sweep.ts). Every 30 minutes:
  // frequent enough that a recovered cert is noticed within the hour,
  // cheap enough (≤25 Cloud Run GETs per run) to be negligible. Same
  // min-instances=1 dependency as AUTH_PRUNE above.
  await boss.createQueue(DOMAIN_VERIFY_SWEEP);
  await boss.work(DOMAIN_VERIFY_SWEEP, async () => {
    const counts = await sweepPendingDomains({ pool: defaultPool });
    if (counts.checked > 0) {
      // eslint-disable-next-line no-console
      console.log("[domain-verify-sweep]", counts);
    }
  });
  await boss.schedule(DOMAIN_VERIFY_SWEEP, "*/30 * * * *", undefined, { tz: "UTC" });

  // D510 (W2-TERM): reap abandoned upload rows (no GCS object) >24h old.
  // Hourly — an abandoned upload is cheap to leave for an hour, and the GCS
  // existence check per candidate keeps each run small. Same
  // min-instances=1 dependency as the sweeps above.
  await boss.createQueue(MEDIA_PENDING_SWEEP);
  await boss.work(MEDIA_PENDING_SWEEP, async () => {
    const counts = await sweepAbandonedUploads({ pool: defaultPool });
    if (counts.deleted > 0) {
      // eslint-disable-next-line no-console
      console.log("[media-pending-sweep]", counts);
    }
  });
  await boss.schedule(MEDIA_PENDING_SWEEP, "17 * * * *", undefined, { tz: "UTC" });

  // D513 (W2-TERM): mark long-unreferenced ready assets, reclaim archived
  // unreferenced ones (GCS objects + row). Daily at 05:10 UTC — overnight,
  // after auth-prune, off the odd-hours cloud routines.
  await boss.createQueue(MEDIA_ORPHAN_SWEEP);
  await boss.work(MEDIA_ORPHAN_SWEEP, async () => {
    const counts = await sweepOrphanAssets({ pool: defaultPool });
    if (counts.marked > 0 || counts.reclaimed > 0) {
      // eslint-disable-next-line no-console
      console.log("[media-orphan-sweep]", counts);
    }
  });
  await boss.schedule(MEDIA_ORPHAN_SWEEP, "10 5 * * *", undefined, { tz: "UTC" });
}

/**
 * Test-only escape hatch. Resets module state so a subsequent
 * `bootJobs` starts fresh. DO NOT call from production code.
 */
export function __resetJobsForTests(): void {
  bossInstance = null;
  bootPromise = null;
  runnerState = { status: "disabled", error: null, since: new Date().toISOString() };
  lastBossError = null;
}
