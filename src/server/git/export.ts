import type { Pool } from "pg";
import { computeGitBlobSha, GithubApiError, type GithubClient, type TreeEntry } from "./client.js";
import { generateBlocksMd, generateReadme, serializeSite } from "./serialize.js";
import { recordExport, recordGitError } from "./state-repo.js";

/**
 * Exporter (T4, GitHub sync): pushes a site's current DB state to the
 * content-monorepo as a single atomic commit, skipping the API round-trip
 * entirely when nothing changed.
 *
 * Flow: `serializeSite` (keys relative to `sites/<slug>/`) → prefix those
 * keys, add the repo-root `README.md`/`BLOCKS.md` → read the ref/tree at
 * HEAD → diff every file's `computeGitBlobSha` against the matching tree
 * entry. All equal → `{skipped: true}`, zero writes (the no-op-export
 * contract serializer.ts's `stableStringify` is what makes this possible —
 * identical DB content always produces identical bytes, hence identical
 * blob shas). Otherwise: blob per changed file, one tree (merged against the
 * base tree — unlisted paths, including other sites' files, are left
 * untouched by GitHub's tree API), one commit carrying the
 * `Anchor-Sync: export` loop-prevention trailer, then move the branch ref.
 *
 * `getTree` is called with the head COMMIT sha (not a separate tree-object
 * sha) — GitHub's Git Data API resolves a commit sha to its tree for both
 * `GET .../git/trees/{sha}` and the `base_tree` field of `POST .../git/trees`,
 * both empirically verified against the live API (bot-review fix round 1) —
 * so no extra "get commit" round-trip is needed to find "the head's tree".
 *
 * Empty-repo bootstrap (fix round 1, Critical): a repo with zero commits has
 * no `refs/heads/<branch>` to read, so `getRefSha` 409s ("Git Repository is
 * empty" — empirically verified against the live API). That 409 is the
 * bootstrap signal: treat the tree as empty (every file is "changed"),
 * `createTree` with NO base tree, `createCommit` with NO parent, then
 * `createRef` (there is no ref yet for `updateRef`'s PATCH to move).
 * `getDefaultBranch` still works on an empty repo — `default_branch` is a
 * repository setting fixed at creation time, independent of commit history —
 * so it needs no special-casing here.
 *
 * Any failure (site lookup, GithubClient call) is recorded via
 * `recordGitError` and rethrown so the caller's job queue retries.
 */
export type ExportResult = { skipped: boolean; sha?: string; files: number };

export async function exportSite(
  pool: Pool,
  siteId: string,
  trigger: string,
  client: GithubClient,
): Promise<ExportResult> {
  try {
    const siteRes = await pool.query<{ slug: string }>(
      `SELECT slug FROM sites WHERE id = $1`,
      [siteId],
    );
    const site = siteRes.rows[0];
    if (!site) {
      throw new Error(`site not found: ${siteId}`);
    }

    const serialized = await serializeSite(pool, siteId);
    const files = new Map<string, string>();
    for (const [key, content] of serialized) {
      files.set(`sites/${site.slug}/${key}`, content);
    }
    files.set("README.md", generateReadme(client.repo));
    files.set("BLOCKS.md", generateBlocksMd());

    const branch = await client.getDefaultBranch();

    // `headSha === null` marks the empty-repo bootstrap path: no existing
    // ref/tree to diff against, so every file below is treated as changed.
    let headSha: string | null = null;
    let tree: TreeEntry[] = [];
    try {
      headSha = await client.getRefSha(branch);
      tree = await client.getTree(headSha);
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 409) {
        headSha = null;
        tree = [];
      } else {
        throw err;
      }
    }

    const shaByPath = new Map(
      tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha] as const),
    );

    const changedPaths: string[] = [];
    for (const [path, content] of files) {
      if (shaByPath.get(path) !== computeGitBlobSha(content)) {
        changedPaths.push(path);
      }
    }

    if (changedPaths.length === 0) {
      return { skipped: true, files: files.size };
    }

    const entries: { path: string; sha: string }[] = [];
    for (const path of changedPaths) {
      const blobSha = await client.createBlob(files.get(path)!);
      entries.push({ path, sha: blobSha });
    }

    const treeSha = await client.createTree(headSha, entries);
    const message = `export(${site.slug}): ${trigger}\n\nAnchor-Sync: export`;
    const commitSha = await client.createCommit(message, treeSha, headSha);
    if (headSha === null) {
      await client.createRef(branch, commitSha);
    } else {
      await client.updateRef(branch, commitSha);
    }
    await recordExport(pool, siteId, commitSha);

    return { skipped: false, sha: commitSha, files: files.size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordGitError(pool, siteId, "export", message).catch(() => undefined);
    throw err;
  }
}
