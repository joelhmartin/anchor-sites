import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { pool as defaultPool } from "../db.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { rateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { resolveGitMode } from "../git/client.js";
import { siteExportDir } from "../git/export.js";
import { getGitState, setGitEnabled } from "../git/state-repo.js";
import { GIT_EXPORT, GIT_IMPORT } from "../jobs/index.js";
import type { GitExportInput } from "../jobs/git-export.js";
import type { GitImportInput } from "./git-webhook.js";

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
   * swallowing pg-boss failures to `null`. Fix round 1 (Important):
   * `GIT_EXPORT` is now a `stately`-policy queue (jobs/index.ts), so a
   * `null` here is ambiguous — "queue genuinely down" or "a job for this
   * site is already queued/active, deduped" — callers below disambiguate
   * via `hasLiveExportJob` before ever reporting a 503.
   */
  enqueueExport?: (input: GitExportInput) => Promise<string | null>;
  /**
   * Injectable for tests. Default: a direct `pgboss.job` existence check
   * (`admin-ai-agent.ts`'s `hasLiveAgentTurnJob` precedent — pg-boss's
   * public API has no "is a job with this singletonKey already
   * queued/active?" query) scoped to `GIT_EXPORT` + this site's
   * `singleton_key`. Used to tell a genuine queue outage apart from a
   * `stately`-policy dedupe when `enqueueExport` returns `null`.
   */
  hasLiveExportJob?: (siteId: string) => Promise<boolean>;
  /**
   * D603/D416 — manual import re-drive. Loads the payload of the most recent
   * GIT_IMPORT job for this site (from pgboss.job's `data`), so the operator
   * can re-run an import that dead-lettered on a transient GitHub blip
   * without pushing a dummy commit. Returns null when the site has never had
   * an import job (nothing to re-drive). Injectable for tests.
   */
  loadLastImportPayload?: (siteId: string) => Promise<GitImportInput | null>;
  /**
   * D603 — re-enqueue an import payload. Default: lazy `getBoss().send(
   * GIT_IMPORT, input, { singletonKey, ...retryOptions })`, swallowing
   * failures to null (disambiguated the same way as export). Injectable for
   * tests.
   */
  enqueueImport?: (input: GitImportInput) => Promise<string | null>;
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
        const { getBoss, GIT_EXPORT_RETRY_OPTIONS } = await import("../jobs/index.js");
        // D618: per-send retry-with-backoff for branch-ref contention
        // (queue-level options never reach an existing deployment).
        return await getBoss().send(GIT_EXPORT, input, {
          singletonKey: input.siteId,
          ...GIT_EXPORT_RETRY_OPTIONS,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[git] pg-boss enqueue failed", err);
        return null;
      }
    });

  // Fix round 1 (Important): GIT_EXPORT is a `stately`-policy queue
  // (jobs/index.ts), so `enqueueExport` returning `null` no longer means
  // only "the queue is down" — it can also mean "deduped: a job for this
  // site is already queued/active". Same precedent as `admin-ai-agent.ts`'s
  // `hasLiveAgentTurnJob`: pg-boss's public API has no per-singletonKey
  // existence query, so this reads pg-boss's own `job` table directly
  // (same database, `pgboss` schema). If that schema doesn't exist yet
  // (jobs never booted — dev/test without JOBS_ENABLED), there's nothing to
  // find; that genuinely can't be a dedupe, so the caller falls through to
  // its "queue unavailable" 503.
  const hasLiveExportJob: (siteId: string) => Promise<boolean> =
    opts.hasLiveExportJob ??
    (async (siteId) => {
      try {
        const r = await pool.query(
          `SELECT 1 FROM pgboss.job
            WHERE name = $1 AND singleton_key = $2 AND state IN ('created','active','retry')
            LIMIT 1`,
          [GIT_EXPORT, siteId],
        );
        return (r.rowCount ?? 0) > 0;
      } catch {
        return false;
      }
    });

  // D603/D416: is there already a live GIT_IMPORT job for this exact
  // `${siteId}:${headSha}`? Distinguishes a re-drive that collided with an
  // in-flight import (fine) from a genuine queue outage when enqueueImport
  // returns null — same precedent as hasLiveExportJob above.
  const hasLiveImportJob = async (siteId: string, headSha: string): Promise<boolean> => {
    try {
      const r = await pool.query(
        `SELECT 1 FROM pgboss.job
          WHERE name = $1 AND singleton_key = $2 AND state IN ('created','active','retry')
          LIMIT 1`,
        [GIT_IMPORT, `${siteId}:${headSha}`],
      );
      return (r.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  };

  // D603/D416: the most recent GIT_IMPORT payload for this site, read from
  // pgboss.job's `data`. Ordered by created_on desc so a re-drive always
  // re-runs the LAST push's import (the one likely to have failed). Tolerant
  // of a missing pgboss schema (dev/test without a boot) → null.
  const loadLastImportPayload: (siteId: string) => Promise<GitImportInput | null> =
    opts.loadLastImportPayload ??
    (async (siteId) => {
      try {
        const r = await pool.query<{ data: GitImportInput }>(
          `SELECT data FROM pgboss.job
            WHERE name = $1 AND data->>'siteId' = $2
            ORDER BY created_on DESC
            LIMIT 1`,
          [GIT_IMPORT, siteId],
        );
        return r.rows[0]?.data ?? null;
      } catch {
        return null;
      }
    });

  const enqueueImport: (input: GitImportInput) => Promise<string | null> =
    opts.enqueueImport ??
    (async (input) => {
      try {
        const { getBoss, GIT_IMPORT_RETRY_OPTIONS } = await import("../jobs/index.js");
        return await getBoss().send(GIT_IMPORT, input, {
          singletonKey: `${input.siteId}:${input.headSha}`,
          ...GIT_IMPORT_RETRY_OPTIONS,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[git] pg-boss import enqueue failed", err);
        return null;
      }
    });

  async function siteExists(siteId: string): Promise<boolean> {
    const r = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId]);
    return (r.rowCount ?? 0) > 0;
  }

  async function siteSlug(siteId: string): Promise<string | null> {
    const r = await pool.query<{ slug: string }>(`SELECT slug FROM sites WHERE id = $1`, [siteId]);
    return r.rows[0]?.slug ?? null;
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
        const repo = configured ? (env.GITHUB_CONTENT_REPO ?? null) : null;
        // D317 — return the canonical GitHub deep link instead of leaving the
        // client to hardcode branch `main` + the `sites/` prefix. `HEAD`
        // resolves to the repo's real default branch (main/master/trunk) with
        // no extra API call, and `siteExportDir` is the exporter's own path
        // constant, so the link tracks the layout if it ever changes.
        let url: string | null = null;
        if (repo && state?.enabled) {
          const slug = await siteSlug(siteId);
          if (slug) url = `https://github.com/${repo}/tree/HEAD/${siteExportDir(slug)}`;
        }
        res.status(200).json({ configured, repo, state, url });
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
            // Fix round 1 (Important): `null` is ambiguous under
            // GIT_EXPORT's `stately` policy — disambiguate before deciding
            // this is a failure (a prior enable/manual-export call may
            // already have one queued/active for this site, which is not a
            // problem at all).
            const deduped = await hasLiveExportJob(siteId);
            if (deduped) {
              res.status(200).json({ state, queued: true, deduped: true });
              return;
            }
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
        if (jobId) {
          res.status(202).json({ queued: true });
          return;
        }

        // Fix round 1 (Important): same disambiguation as the enable
        // handler above — `null` can mean this site already has a
        // queued/active GIT_EXPORT job (e.g. a double-click, or the
        // initial export from `enable` still running), not a queue outage.
        const deduped = await hasLiveExportJob(siteId);
        if (deduped) {
          res.status(202).json({ queued: true, deduped: true });
          return;
        }

        // eslint-disable-next-line no-console
        console.error("[git] export enqueue returned no id — reporting 503", { siteId });
        res.status(503).json({ error: "job queue unavailable" });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // POST /sites/:siteId/git/import — D603/D416 manual import re-drive.
  // Re-enqueues the most recent import payload for the site (the one a
  // transient GitHub blip likely dead-lettered). The import handler is
  // idempotent (last_import_sha gate + per-file revisions), so re-driving an
  // already-applied sha is a harmless no-op; re-driving a failed one re-runs
  // it. GitCard's import re-drive button (D416) is the consumer.
  // ---------------------------------------------------------------------
  router.post(
    "/sites/:siteId/git/import",
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

        const payload = await loadLastImportPayload(siteId);
        if (!payload) {
          res.status(404).json({ error: "no import to re-drive for this site" });
          return;
        }

        const jobId = await enqueueImport(payload);
        if (jobId) {
          res.status(202).json({ queued: true, headSha: payload.headSha });
          return;
        }

        // null under stately = already queued/active for this exact sha (a
        // re-drive that collided with an in-flight import) OR a genuine
        // outage. A live job for the same key means the re-drive is already
        // happening — report success; otherwise the queue is unavailable.
        const deduped = await hasLiveImportJob(siteId, payload.headSha);
        if (deduped) {
          res.status(202).json({ queued: true, deduped: true, headSha: payload.headSha });
          return;
        }
        // eslint-disable-next-line no-console
        console.error("[git] import re-drive enqueue returned no id — reporting 503", { siteId });
        res.status(503).json({ error: "job queue unavailable" });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
