import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { resolveGitMode } from "../git/client.js";
import { getGitState } from "../git/state-repo.js";
import { GIT_IMPORT } from "../jobs/index.js";

/**
 * Push webhook route (GitHub sync plan, Task 5). GitHub POSTs here on every
 * push to the content monorepo; a verified push against the repo's default
 * branch is filtered, grouped by `sites/<slug>/` prefix, and fanned out into
 * one `git.import` job per enabled site. Task 6 owns the job handler itself
 * (this task only defines the queue name + the input shape it produces).
 *
 * Unlike every other route in this codebase, this one is NOT gated by
 * `requireAdmin()` — GitHub can't send an admin token. The HMAC signature
 * check (`X-Hub-Signature-256` against the raw request body, via
 * `verifyGithubSignature`) is the entire auth story here, which is why it
 * must run before anything else touches the payload.
 */

/**
 * `app.ts`'s `express.json({ verify })` hook (Global Constraints, raw-body
 * rule) stashes the exact bytes it parsed onto the request so this route can
 * re-verify the HMAC against the same bytes GitHub signed — JSON.stringify of
 * the parsed body is NOT guaranteed to byte-match the original (key order,
 * whitespace), so re-serializing would make signature verification flaky.
 */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** Produced by this task; Task 6 consumes it as `git.import`'s job input. */
export type GitImportInput = { siteId: string; headSha: string; paths: string[] };

export type GitWebhookOptions = {
  pool?: Pool;
  /**
   * Inject the enqueue call for tests. Defaults to the lazy
   * `getBoss().send(GIT_IMPORT, input, { singletonKey: `${siteId}:${headSha}` })`
   * idiom (routes/media.ts precedent, keyed on the pair — see the fix round 1
   * note below), wrapped in try/catch so a pg-boss hiccup for one site never
   * 500s the whole webhook response.
   *
   * Fix round 1 (Important 3): GIT_IMPORT runs under pg-boss's `stately`
   * policy (jobs/index.ts), where a second `send()` for a key that already
   * has a queued/active job returns `null` instead of queuing anything.
   * Keying on bare `siteId` (the original shape) meant a second REAL push to
   * the same site — different content, different `headSha` — while the
   * first push's import was still queued/active would silently return
   * `null` and never queue at all; nothing retries a job that was never
   * created, so that push's edits would be lost for good. Keying on
   * `${siteId}:${headSha}` keeps the dedupe pg-boss's `stately` policy is
   * FOR (a redelivered webhook for the SAME push collapsing to one job)
   * while letting two distinct pushes to the same site both queue.
   */
  enqueueImport?: (input: GitImportInput) => Promise<string | null>;
  /**
   * D602/D116: disambiguates a `null` `enqueueImport` return. Under
   * GIT_IMPORT's `stately` policy, `send()` returns `null` for TWO different
   * reasons — "a job for this `${siteId}:${headSha}` is already queued/active"
   * (a redelivered webhook for the same push, which is fine) vs. "the queue is
   * genuinely down" (work is being LOST). The webhook must not ack the second
   * case with `202 {queued}` — GitHub would never redeliver. Default: a direct
   * `pgboss.job` existence check keyed on the same `${siteId}:${headSha}`
   * singleton (admin-git.ts's `hasLiveExportJob` precedent). Returns false when
   * the pgboss schema doesn't exist yet (nothing to find → not a dedupe → the
   * caller treats the null as a genuine failure and 5xx's).
   */
  hasLiveImportJob?: (siteId: string, headSha: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
};

const HUB_SIGNATURE_PREFIX = "sha256=";

/** `sha256=<hex>` against `secret`; `false` on any malformed input (never throws). */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(HUB_SIGNATURE_PREFIX)) return false;
  const providedHex = signatureHeader.slice(HUB_SIGNATURE_PREFIX.length);
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  // timingSafeEqual throws on a length mismatch — guard first. Buffers of
  // different lengths can never be a signature match anyway.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Loop-prevention trailer every export commit message ends with. */
const EXPORT_TRAILER = "Anchor-Sync: export";

/** Matches paths this sync cares about: `sites/<slug>/...`. */
const SITE_PATH_RE = /^sites\/([a-z0-9-]+)\//;

type PushCommit = {
  message?: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
};

type PushPayload = {
  ref?: string;
  after?: string;
  repository?: { default_branch?: string };
  commits?: PushCommit[];
};

type SlugGroup = { addedOrModified: Set<string>; removed: Set<string> };

export function gitWebhookRouter(opts: GitWebhookOptions = {}): Router {
  const pool = opts.pool ?? defaultPool;
  const env = opts.env ?? process.env;

  const enqueueImport =
    opts.enqueueImport ??
    (async (input: GitImportInput) => {
      try {
        const { getBoss, GIT_IMPORT_RETRY_OPTIONS } = await import("../jobs/index.js");
        // D603: deliberate retry+backoff per-send (createQueue options never
        // reach an existing deployment — same reason GIT_EXPORT applies its
        // ladder at every send site).
        return await getBoss().send(GIT_IMPORT, input, {
          singletonKey: `${input.siteId}:${input.headSha}`,
          ...GIT_IMPORT_RETRY_OPTIONS,
        });
      } catch {
        return null;
      }
    });

  // D602/D116: default disambiguator for a null enqueue — see the option's doc.
  const hasLiveImportJob: (siteId: string, headSha: string) => Promise<boolean> =
    opts.hasLiveImportJob ??
    (async (siteId, headSha) => {
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
    });

  const router = Router();

  router.post(
    "/git/webhook",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Mirrors resolveGitMode's token-sentinel convention (client.ts):
        // Task 8 seeds GITHUB_WEBHOOK_SECRET with the literal placeholder
        // value "disabled" in Secret Manager before a real secret is
        // generated (step 3 of the runbook below). That placeholder is
        // documented in this very file — treating it as "configured" would
        // let anyone compute a valid HMAC against the publicly-known value
        // and forge pushes against a deployment that just hasn't rotated
        // the secret yet. Same 503 as the unset case; the caller can't tell
        // (and shouldn't be able to) which of the two placeholder states it
        // is.
        const secret = env.GITHUB_WEBHOOK_SECRET;
        if (!secret || secret === "disabled") {
          res.status(503).json({ error: "webhook not configured" });
          return;
        }

        // Signature check BEFORE any use of the parsed payload — the raw
        // bytes come from app.ts's express.json `verify` hook.
        const rawBody = (req as RawBodyRequest).rawBody ?? Buffer.alloc(0);
        const signatureHeader = req.header("X-Hub-Signature-256");
        if (!verifyGithubSignature(secret, rawBody, signatureHeader)) {
          res.status(401).json({ error: "invalid signature" });
          return;
        }

        if (req.header("X-GitHub-Event") !== "push") {
          res.status(204).end();
          return;
        }

        const payload = req.body as PushPayload;
        const defaultBranch = payload?.repository?.default_branch;
        // Fold the `after` presence check in here (round 1 review fix): a
        // push payload missing its head sha is just as malformed as one
        // missing `ref`/`repository.default_branch` — 204, not an empty-
        // string headSha silently smuggled into the enqueue payload below.
        if (
          !payload?.ref ||
          !defaultBranch ||
          payload.ref !== `refs/heads/${defaultBranch}` ||
          !payload.after
        ) {
          res.status(204).end();
          return;
        }

        const commits = payload.commits ?? [];
        // Loop prevention: every commit in this push carries the export
        // trailer → this push originated from our own exporter. Vacuously
        // true (and therefore 204) for an empty commit list too — there's
        // nothing to import either way.
        const allTrailer = commits.every(
          (c) => typeof c.message === "string" && c.message.includes(EXPORT_TRAILER),
        );
        if (allTrailer) {
          res.status(204).end();
          return;
        }

        // Round 1 review fix (Important): cheap-gate-first, mirroring
        // git-export.ts/handleGitExport's established convention. With git
        // sync globally disabled (no GITHUB_CONTENT_TOKEN/REPO), no site
        // could legitimately have `getGitState(...).enabled === true` in the
        // first place — but without this check every push still pays a
        // `sites` SELECT + `getGitState` read + a persisted pg-boss job per
        // referenced site, and a `202 {queued:[...]}` response would lie
        // about "queued" work Task 6's import job will only silently no-op.
        // No DB I/O happens above this line, so disabled deployments never
        // touch the pool at all.
        if (resolveGitMode(env) === "disabled") {
          res.status(204).end();
          return;
        }

        // Group distinct changed paths by `sites/<slug>/` prefix. added +
        // modified are merged (both mean "(re-)import this file"); removed
        // is kept separate so the import job can tell the two apart.
        const bySlug = new Map<string, SlugGroup>();
        const groupFor = (slug: string): SlugGroup => {
          let group = bySlug.get(slug);
          if (!group) {
            group = { addedOrModified: new Set(), removed: new Set() };
            bySlug.set(slug, group);
          }
          return group;
        };
        for (const commit of commits) {
          for (const p of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
            const match = SITE_PATH_RE.exec(p);
            if (match) groupFor(match[1]).addedOrModified.add(p);
          }
          for (const p of commit.removed ?? []) {
            const match = SITE_PATH_RE.exec(p);
            if (match) groupFor(match[1]).removed.add(p);
          }
        }

        const queued: string[] = [];
        const failed: string[] = [];
        for (const [slug, group] of bySlug) {
          const siteRes = await pool.query<{ id: string }>(
            `SELECT id FROM sites WHERE slug = $1`,
            [slug],
          );
          if (siteRes.rowCount === 0) continue;
          const siteId = siteRes.rows[0].id;

          const state = await getGitState(pool, siteId);
          if (!state?.enabled) continue;

          const paths = [
            ...group.addedOrModified,
            ...[...group.removed].map((p) => `REMOVED:${p}`),
          ];

          // D602/D116: check the enqueue RESULT, don't ack blindly. A thrown
          // error or a `null` return both mean "no id came back" — the default
          // enqueueImport swallows pg-boss failures to null. Under GIT_IMPORT's
          // stately policy, null is ambiguous: a genuine queue outage (work is
          // being LOST) vs. a dedupe of a redelivered webhook for the same
          // `${siteId}:${headSha}` (fine). Disambiguate via hasLiveImportJob
          // before deciding — only a genuine failure lands in `failed`.
          let jobId: string | null = null;
          try {
            jobId = await enqueueImport({ siteId, headSha: payload.after, paths });
          } catch {
            jobId = null;
          }
          if (jobId) {
            queued.push(slug);
            continue;
          }
          const deduped = await hasLiveImportJob(siteId, payload.after);
          if (deduped) {
            queued.push(slug);
          } else {
            failed.push(slug);
          }
        }

        // D602/D116: never ack lost work with 202. If ANY site's import
        // genuinely failed to queue, return 5xx so GitHub's delivery log shows
        // the delivery failed and REDELIVERS it — the import is idempotent
        // (last_import_sha gate), and any site that DID queue dedupes on
        // redelivery, so re-driving the whole push is safe.
        if (failed.length > 0) {
          res.status(503).json({ error: "import enqueue failed", queued, failed });
          return;
        }

        if (queued.length === 0) {
          res.status(204).end();
          return;
        }
        res.status(202).json({ queued });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
