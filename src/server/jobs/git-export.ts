import type { Pool } from "pg";
import { makeGithubClient, resolveGitMode, type GithubClient } from "../git/client.js";
import { getGitState } from "../git/state-repo.js";
import { exportSite } from "../git/export.js";

/**
 * pg-boss handler for `git.export` (T4, GitHub sync).
 *
 * Gate order mirrors every other git-sync entry point: the cheap,
 * network/DB-free `resolveGitMode()` check first (mode disabled means the
 * operator never configured GITHUB_CONTENT_TOKEN/REPO — nothing to do,
 * ever), then the one `getGitState` SELECT (a site can be in "api" mode
 * globally but not have opted this particular site into sync, or have
 * disabled it after enabling). Either miss returns silently — a log line,
 * not a thrown error, since a queued export for a site that's since been
 * disabled isn't a failure.
 *
 * The real `GithubClient` is only constructed when both gates pass and the
 * caller didn't inject one — `makeGithubClient()` itself throws in disabled
 * mode, so by construction it's never called when mode is "disabled".
 */
export type GitExportInput = { siteId: string; trigger: string };
export type GitExportDeps = { pool: Pool; client?: GithubClient };

export async function handleGitExport(data: GitExportInput, deps: GitExportDeps): Promise<void> {
  const { pool } = deps;

  if (resolveGitMode() === "disabled") {
    // eslint-disable-next-line no-console
    console.log(`[git.export] skipping site ${data.siteId}: git sync disabled`);
    return;
  }

  const state = await getGitState(pool, data.siteId);
  if (!state || !state.enabled) {
    // eslint-disable-next-line no-console
    console.log(`[git.export] skipping site ${data.siteId}: git sync not enabled`);
    return;
  }

  const client = deps.client ?? makeGithubClient();
  await exportSite(pool, data.siteId, data.trigger, client);
}
