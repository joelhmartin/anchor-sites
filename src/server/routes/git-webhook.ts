import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
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
   * `getBoss().send(GIT_IMPORT, input, { singletonKey: siteId })` idiom
   * (routes/media.ts precedent), wrapped in try/catch so a pg-boss hiccup
   * for one site never 500s the whole webhook response.
   */
  enqueueImport?: (input: GitImportInput) => Promise<string | null>;
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
        const { getBoss } = await import("../jobs/index.js");
        return await getBoss().send(GIT_IMPORT, input, { singletonKey: input.siteId });
      } catch {
        return null;
      }
    });

  const router = Router();

  router.post(
    "/git/webhook",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const secret = env.GITHUB_WEBHOOK_SECRET;
        if (!secret) {
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
        if (!payload?.ref || !defaultBranch || payload.ref !== `refs/heads/${defaultBranch}`) {
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

          try {
            await enqueueImport({ siteId, headSha: payload.after ?? "", paths });
            queued.push(slug);
          } catch {
            // Per-site fan-out is best-effort — one site's enqueue failure
            // must never sink the response for every other site in this push.
          }
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
