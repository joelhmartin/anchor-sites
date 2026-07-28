import type { Pool } from "pg";
import { GithubApiError, makeGithubClient, resolveGitMode, type GithubClient } from "../git/client.js";
import { getGitState, recordGitError, recordImport } from "../git/state-repo.js";
import { parsePageFile, parseSiteFile, type FileParseError } from "../git/serialize.js";
import { validateBlocks, type BlockShape } from "../../blocks/validate.js";
import { evictSiteCacheForSite } from "../../middleware/resolveSite.js";
import type { GitImportInput } from "../routes/git-webhook.js";
// Side-effect: register the static + package blocks before validateBlocks
// runs against them (mirrors tools/pages.ts, tools/settings.ts, serialize.ts).
import "../../blocks/index.js";

/**
 * pg-boss handler for `git.import` (T6, GitHub sync).
 *
 * Consumes the `GitImportInput` the webhook route (T5) fans out per site:
 * `{ siteId, headSha, paths }`, where `paths` are repo-root-relative
 * (`sites/<slug>/...`) and a `REMOVED:` prefix marks a deletion. Every
 * `pages/*.json` and `site.json` edit is fetched at `headSha` and pushed
 * through the SAME validation gate the human save path and the AI editor
 * use (`blockShape`/`pageFileSchema` structural check via `parsePageFile`,
 * then `validateBlocks` against the live registry, then an asset-id
 * existence check against `media_assets`) before it's applied as a new
 * `page_revisions` row. Nothing here bypasses that gate — a file that fails
 * any stage is skipped (not applied) and reported back as a comment on the
 * triggering commit, while every other valid file in the same push still
 * lands.
 *
 * Gate order mirrors `git-export.ts`: cheap `resolveGitMode()` first (no
 * token/repo configured — nothing to ever do), then the one `getGitState`
 * SELECT (site opted out or never opted in), then an idempotency check
 * (`last_import_sha === headSha` — a redelivered/duplicate webhook for a sha
 * already applied is a silent no-op, since re-fetching and re-validating
 * unchanged content would just produce byte-identical revisions for no
 * benefit).
 *
 * Failure handling has two tiers, matching the plan's Global Constraints:
 *   - VALIDATION failures (malformed JSON, schema violations, unknown block
 *     types/props, unknown media asset ids) are data problems, not
 *     transient ones — they're accumulated into `failures` and the loop
 *     continues to the next file. They never throw.
 *   - FETCH/API/DB failures (a `getFileAtRef` network hiccup, a lost DB
 *     connection mid-transaction) are unexpected — they propagate out of
 *     the per-file helpers uncaught, hit the single outer `try/catch`
 *     below (same shape as `exportSite`), get recorded via
 *     `recordGitError`, and are rethrown so pg-boss retries the whole job.
 *     Idempotence make replays safe: revisions are only written for files
 *     that already validated, and re-applying identical content produces a
 *     harmless identical revision.
 *
 * Fix round 1 (Important 1) carves out ONE exception from the "fetch errors
 * rethrow" rule above: a 404 from `getFileAtRef` specifically (`GithubApiError`
 * with `status === 404`) is downgraded to a per-file VALIDATION failure
 * instead. This is the edit-then-delete race — a push that both modifies and
 * later removes the same path lands the modified copy in `addedOrModified`
 * (the webhook route dedupes per-path but doesn't diff the two lists against
 * each other), and by the time this job fetches it at `headSha` the file is
 * already gone. Treating that as a hard failure would rethrow, dead-letter
 * the whole job after retries, and never apply any of the OTHER valid files
 * in the same push. A 404 for any other reason (bad path, wrong ref) is
 * indistinguishable from this race at this layer, so it gets the same
 * tolerant treatment — either way there is nothing to validate.
 *
 * `recordImport` runs whenever the loop completes without throwing — even
 * when some files failed validation, since the sha as a whole WAS
 * processed (the plan's "partially applied" case); `recordGitError` is
 * called AFTER `recordImport` in that case specifically so its
 * `last_error` write is the one left standing (`recordImport` itself always
 * clears `last_error`, so calling it second would erase the failure summary
 * `recordGitError` just wrote).
 *
 * Fix round 1 (Important 2): the commit-comment body is bounded (at most
 * `MAX_ITEMS_PER_SECTION` bulleted items per section, "…and N more"
 * otherwise) — an unbounded body built from, say, hundreds of failed pages
 * can exceed GitHub's comment size limit and 422. Posting the comment is
 * ALSO wrapped in its own try/catch: a comment-post failure downgrades to a
 * `console.warn` plus a `recordGitError` write of the validation SUMMARY
 * (not the HTTP error text) rather than throwing. Letting it throw would
 * propagate to the outer catch below, which would `recordGitError` the HTTP
 * error message instead — overwriting the correct summary this same run
 * already wrote — and then rethrow for a retry that immediately no-ops at
 * the idempotency gate above (since `recordImport` already advanced
 * `last_import_sha` earlier in THIS run), permanently losing the real
 * failure report behind meaningless HTTP noise with no way to recover it.
 */
export type GitImportDeps = { pool: Pool; client?: GithubClient };

type FileFailure = { path: string; errors: FileParseError[] };

const REMOVED_PREFIX = "REMOVED:";
const SITE_PREFIX_RE = /^sites\/[a-z0-9-]+\/(.+)$/;
const PAGE_PATH_RE = /^pages\/([a-z0-9-]+)\.json$/;
const IGNORED_BASENAMES = new Set(["media.json", "README.md", "BLOCKS.md"]);
const ASSET_ID_KEY_RE = /asset_id$/i;
/** Cap on bulleted items per section in the commit comment (fix round 1, Important 2). */
const MAX_ITEMS_PER_SECTION = 20;

/** Strip the `sites/<slug>/` prefix a webhook-sourced path always carries. */
function relativePath(path: string): string {
  const match = SITE_PREFIX_RE.exec(path);
  return match ? match[1] : path;
}

/**
 * `client.getFileAtRef`, tolerant of a 404 specifically (fix round 1,
 * Important 1 — the edit-then-delete-in-one-push race, see the module doc
 * comment). A 404 is recorded as a per-file validation failure and the
 * caller gets `undefined` back (nothing to apply); any other error
 * (network, auth, 5xx) propagates uncaught so the outer `try/catch` in
 * `handleGitImport` records it and rethrows for a pg-boss retry.
 */
async function fetchFile(
  client: GithubClient,
  data: GitImportInput,
  path: string,
  failures: FileFailure[],
): Promise<string | undefined> {
  try {
    return await client.getFileAtRef(path, data.headSha);
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 404) {
      failures.push({
        path,
        errors: [
          {
            path: "(root)",
            message: `file not present at ${data.headSha.slice(0, 7)} (deleted later in push?)`,
          },
        ],
      });
      return undefined;
    }
    throw err;
  }
}

/**
 * Generic recursive scan for asset references: ANY string value under a key
 * matching `/asset_id$/i`, at any depth (covers the flat `image` block's
 * `asset_id` prop and the nested `hero-slider` shape's
 * `slides[].image_asset_id`, plus any future block's `*_asset_id` field,
 * without needing a per-block-type allowlist).
 */
function collectAssetIdsGeneric(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIdsGeneric(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ASSET_ID_KEY_RE.test(key) && typeof child === "string" && child) {
        out.add(child);
      } else {
        collectAssetIdsGeneric(child, out);
      }
    }
  }
  return out;
}

function summarizeFailures(failures: FileFailure[]): string {
  return failures
    .map((f) => `${f.path}: ${f.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`)
    .join(" | ");
}

/** Push at most `MAX_ITEMS_PER_SECTION` bulleted `line`s, then a remainder note. */
function pushCappedBullets<T>(lines: string[], items: T[], toLine: (item: T) => string): void {
  const shown = items.slice(0, MAX_ITEMS_PER_SECTION);
  for (const item of shown) lines.push(`- ${toLine(item)}`);
  const remaining = items.length - shown.length;
  if (remaining > 0) lines.push(`- …and ${remaining} more`);
}

function buildCommentBody(
  headSha: string,
  failures: FileFailure[],
  removed: string[],
  ignored: string[],
): string {
  const lines: string[] = [`Import of \`${headSha.slice(0, 7)}\`:`];
  if (failures.length > 0) {
    lines.push("", "**Rejected (validation failed — not applied):**");
    pushCappedBullets(lines, failures, (f) => {
      const detail = f.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      return `\`${f.path}\`: ${detail}`;
    });
  }
  if (removed.length > 0) {
    lines.push("", "**Deleted in the repo (page NOT deleted — delete it from the Studio itself):**");
    pushCappedBullets(lines, removed, (path) => `\`${path}\``);
  }
  if (ignored.length > 0) {
    lines.push("", "**Ignored (generated file — edits here are not imported):**");
    pushCappedBullets(lines, ignored, (path) => `\`${path}\``);
  }
  return lines.join("\n");
}

async function applySiteFile(
  pool: Pool,
  client: GithubClient,
  data: GitImportInput,
  path: string,
  failures: FileFailure[],
): Promise<void> {
  const content = await fetchFile(client, data, path, failures);
  if (content === undefined) return;
  const parsed = parseSiteFile(content);
  if (!parsed.ok) {
    failures.push({ path, errors: parsed.errors });
    return;
  }
  const site = parsed.site;

  // Same semantics as tools/settings.ts's set_brand_tokens/set_seo_defaults:
  // brand tokens REPLACE wholesale, seo_defaults shallow-MERGE over what's
  // already in the database (a key this file omits survives untouched).
  const current = await pool.query<{ seo_defaults: Record<string, unknown> | null }>(
    `SELECT seo_defaults FROM sites WHERE id = $1`,
    [data.siteId],
  );
  const mergedSeoDefaults = { ...(current.rows[0]?.seo_defaults ?? {}), ...site.seo_defaults };

  await pool.query(
    `UPDATE sites SET default_brand_tokens = $1::jsonb, seo_defaults = $2::jsonb WHERE id = $3`,
    [JSON.stringify(site.default_brand_tokens), JSON.stringify(mergedSeoDefaults), data.siteId],
  );
  await evictSiteCacheForSite(pool, data.siteId);
}

async function applyPageFile(
  pool: Pool,
  client: GithubClient,
  data: GitImportInput,
  path: string,
  slug: string,
  failures: FileFailure[],
): Promise<void> {
  const content = await fetchFile(client, data, path, failures);
  if (content === undefined) return;
  const parsed = parsePageFile(content);
  if (!parsed.ok) {
    failures.push({ path, errors: parsed.errors });
    return;
  }
  const page = parsed.page;

  // Registry-level validation (unknown types, invalid props) — parsePageFile
  // only checked the structural shape.
  const blockFailures = validateBlocks(page.blocks as BlockShape[]);
  if (blockFailures.length > 0) {
    failures.push({
      path,
      errors: blockFailures.map((f) => ({
        path: `blocks[${f.index}] (${f.type})`,
        message:
          f.reason === "unknown_type"
            ? "unknown block type"
            : (f.errors ?? []).map((e) => `${e.path}: ${e.message}`).join("; "),
      })),
    });
    return;
  }

  // Registry gate, part two: every referenced media asset must already
  // exist for this site. `id::text = ANY($2::text[])` (not
  // `ANY($2::uuid[])`) deliberately casts the DB COLUMN to text rather than
  // the input array to uuid — a hand-edited file can put an arbitrary
  // non-uuid string in an `*_asset_id` field, and that must surface as a
  // normal "unknown asset" validation failure, not an uncaught
  // invalid-uuid-literal exception that would abort the whole job.
  const assetIds = [...collectAssetIdsGeneric(page.blocks)];
  if (assetIds.length > 0) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM media_assets WHERE site_id = $1 AND id::text = ANY($2::text[])`,
      [data.siteId, assetIds],
    );
    const existingIds = new Set(existing.rows.map((r) => r.id));
    const missing = assetIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      failures.push({
        path,
        errors: missing.map((id) => ({
          path: "asset_id",
          message: `references unknown media asset: ${id}`,
        })),
      });
      return;
    }
  }

  const seo = page.seo ?? {};
  const source = `git:${data.headSha.slice(0, 7)}`;

  // Single transactional save + one revision — same BEGIN/mutate/INSERT
  // page_revisions/COMMIT pattern as tools/pages.ts, tools/settings.ts. No
  // pre-write snapshot revision: unlike the AI editor's Revert flow, an
  // import has nothing that needs to restore to "the state before this
  // import" — the prior state is already the latest existing revision.
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existingPage = await dbClient.query<{ id: string }>(
      `SELECT id FROM pages WHERE site_id = $1 AND slug = $2 FOR UPDATE`,
      [data.siteId, slug],
    );
    let pageId: string;
    if ((existingPage.rowCount ?? 0) > 0) {
      pageId = existingPage.rows[0].id;
      await dbClient.query(
        `UPDATE pages SET blocks = $1::jsonb, seo = $2::jsonb, title = $3, status = $4, updated_at = now()
         WHERE id = $5`,
        [JSON.stringify(page.blocks), JSON.stringify(seo), page.title, page.status, pageId],
      );
    } else {
      const inserted = await dbClient.query<{ id: string }>(
        `INSERT INTO pages (site_id, slug, title, blocks, seo, status)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         RETURNING id`,
        [data.siteId, slug, page.title, JSON.stringify(page.blocks), JSON.stringify(seo), page.status],
      );
      pageId = inserted.rows[0].id;
    }
    await dbClient.query(
      `INSERT INTO page_revisions (page_id, blocks, seo, source)
       VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
      [pageId, JSON.stringify(page.blocks), JSON.stringify(seo), source],
    );
    await dbClient.query("COMMIT");
  } catch (err) {
    await dbClient.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function handleGitImport(data: GitImportInput, deps: GitImportDeps): Promise<void> {
  const { pool } = deps;

  if (resolveGitMode() === "disabled") {
    // eslint-disable-next-line no-console
    console.log(`[git.import] skipping site ${data.siteId}: git sync disabled`);
    return;
  }

  const state = await getGitState(pool, data.siteId);
  if (!state || !state.enabled) {
    // eslint-disable-next-line no-console
    console.log(`[git.import] skipping site ${data.siteId}: git sync not enabled`);
    return;
  }

  if (state.last_import_sha === data.headSha) {
    // eslint-disable-next-line no-console
    console.log(`[git.import] skipping site ${data.siteId}: sha ${data.headSha} already imported`);
    return;
  }

  const client = deps.client ?? makeGithubClient();

  const failures: FileFailure[] = [];
  const removed: string[] = [];
  const ignored: string[] = [];

  try {
    for (const raw of data.paths) {
      if (raw.startsWith(REMOVED_PREFIX)) {
        removed.push(relativePath(raw.slice(REMOVED_PREFIX.length)));
        continue;
      }

      const rel = relativePath(raw);
      const basename = rel.split("/").pop() ?? rel;
      if (IGNORED_BASENAMES.has(basename)) {
        ignored.push(rel);
        continue;
      }

      if (rel === "site.json") {
        await applySiteFile(pool, client, data, raw, failures);
        continue;
      }

      const pageMatch = PAGE_PATH_RE.exec(rel);
      if (pageMatch) {
        await applyPageFile(pool, client, data, raw, pageMatch[1], failures);
        continue;
      }

      // Unrecognized path shape under sites/<slug>/ (e.g. a stray file a
      // human dropped in the repo) — not one of the known file kinds, so
      // there's nothing to apply, but it's still worth a note rather than
      // silent non-action.
      ignored.push(rel);
    }

    // Runs whenever the loop above completes without throwing — including
    // when some files failed validation (the "partially applied" case):
    // the sha as a whole was processed, and the comment carries what
    // didn't land. recordGitError (below) runs AFTER this specifically
    // because recordImport always clears last_error; calling it second
    // would erase the failure summary just written.
    await recordImport(pool, data.siteId, data.headSha);

    if (failures.length > 0) {
      await recordGitError(pool, data.siteId, summarizeFailures(failures));
    }

    if (failures.length > 0 || removed.length > 0 || ignored.length > 0) {
      try {
        await client.createCommitComment(
          data.headSha,
          buildCommentBody(data.headSha, failures, removed, ignored),
        );
      } catch (commentErr) {
        // Fix round 1 (Important 2): swallow here, not the outer catch — see
        // the module doc comment. `last_error` gets the validation summary
        // (already written above when failures.length > 0), never the HTTP
        // error text from the failed comment post.
        const message = commentErr instanceof Error ? commentErr.message : String(commentErr);
        // eslint-disable-next-line no-console
        console.warn(
          `[git.import] createCommitComment failed for site ${data.siteId} @ ${data.headSha}: ${message}`,
        );
        if (failures.length > 0) {
          await recordGitError(pool, data.siteId, summarizeFailures(failures)).catch(() => undefined);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordGitError(pool, data.siteId, message).catch(() => undefined);
    throw err;
  }
}
