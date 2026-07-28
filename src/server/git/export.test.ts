import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { computeGitBlobSha, GithubApiError, type GithubClient, type TreeEntry } from "./client.js";
import { getGitState } from "./state-repo.js";
import { exportSite } from "./export.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

/**
 * In-memory fake GithubClient. Mirrors the real REST client's contract
 * closely enough to exercise the exporter's diff/commit/ref-move logic
 * without touching the network: `createTree` merges the supplied entries
 * onto the base tree's entries (same "unlisted paths untouched" semantic
 * GitHub's real Git Data API has), and `createCommit` publishes that merged
 * tree under the new commit sha so a subsequent `getTree(headSha)` sees it —
 * which is what makes the no-op-skip re-export test meaningful. Passing the
 * head COMMIT sha as `createTree`'s base tree (rather than a separate tree
 * object sha) mirrors the real client/API — empirically verified against
 * the live API (bot-review fix round 1) that GitHub resolves a commit sha to
 * its tree for both reads and `base_tree` — so this fake keys its tree map
 * by both commit and tree shas interchangeably, same as the real thing.
 *
 * `{ empty: true }` constructs a client simulating a brand-new repo with
 * zero commits: `getRefSha` 409s until `createRef` (or `updateRef`) gives it
 * a head sha, exercising the exporter's empty-repo bootstrap path.
 */
class FakeGithubClient implements GithubClient {
  repo = "acme/content";
  branch = "main";
  headSha: string | null;
  private treesByCommitOrTreeSha = new Map<string, TreeEntry[]>();
  private commitCounter = 0;
  private treeCounter = 0;

  createBlobCalls: string[] = [];
  createTreeCalls: { baseTreeSha: string | null; entries: { path: string; sha: string | null }[] }[] = [];
  createCommitCalls: { message: string; treeSha: string; parentSha: string | null }[] = [];
  updateRefCalls: { branch: string; sha: string }[] = [];
  createRefCalls: { branch: string; sha: string }[] = [];
  commitComments: { sha: string; body: string }[] = [];

  constructor(opts: { empty?: boolean } = {}) {
    if (opts.empty) {
      this.headSha = null;
    } else {
      this.headSha = "commit-0";
      this.treesByCommitOrTreeSha.set("commit-0", []);
    }
  }

  async getDefaultBranch(): Promise<string> {
    // Real behavior (fix round 1): default_branch is a repo setting fixed at
    // creation, independent of commit history — it resolves fine even for a
    // brand-new/empty repo, so the fake needs no special-casing here either.
    return this.branch;
  }

  async getRefSha(_branch: string): Promise<string> {
    if (this.headSha === null) {
      throw new GithubApiError(
        `github GET /repos/${this.repo}/git/ref/heads/${this.branch} failed: 409 Git Repository is empty`,
        409,
      );
    }
    return this.headSha;
  }

  async getTree(sha: string): Promise<TreeEntry[]> {
    return this.treesByCommitOrTreeSha.get(sha) ?? [];
  }

  async getFileAtRef(_path: string, _ref: string): Promise<string> {
    throw new Error("not used by the exporter");
  }

  async createBlob(content: string): Promise<string> {
    this.createBlobCalls.push(content);
    return computeGitBlobSha(content);
  }

  async createTree(
    baseTreeSha: string | null,
    entries: { path: string; sha: string | null }[],
  ): Promise<string> {
    this.createTreeCalls.push({ baseTreeSha, entries });
    const base = baseTreeSha !== null ? this.treesByCommitOrTreeSha.get(baseTreeSha) ?? [] : [];
    const merged = new Map(base.map((entry) => [entry.path, entry] as const));
    for (const entry of entries) {
      if (entry.sha === null) {
        merged.delete(entry.path);
      } else {
        merged.set(entry.path, { path: entry.path, sha: entry.sha, type: "blob" });
      }
    }
    const treeSha = `tree-${++this.treeCounter}`;
    this.treesByCommitOrTreeSha.set(treeSha, [...merged.values()]);
    return treeSha;
  }

  async createCommit(message: string, treeSha: string, parentSha: string | null): Promise<string> {
    this.createCommitCalls.push({ message, treeSha, parentSha });
    const commitSha = `commit-${++this.commitCounter}`;
    this.treesByCommitOrTreeSha.set(commitSha, this.treesByCommitOrTreeSha.get(treeSha) ?? []);
    return commitSha;
  }

  async updateRef(branch: string, sha: string): Promise<void> {
    this.updateRefCalls.push({ branch, sha });
    this.headSha = sha;
  }

  async createRef(branch: string, sha: string): Promise<void> {
    this.createRefCalls.push({ branch, sha });
    this.headSha = sha;
  }

  async createCommitComment(sha: string, body: string): Promise<void> {
    this.commitComments.push({ sha, body });
  }
}

/** A client whose getDefaultBranch always throws, to exercise the error path. */
class ThrowingGithubClient extends FakeGithubClient {
  async getDefaultBranch(): Promise<string> {
    throw new Error("simulated github outage");
  }
}

d("exportSite", () => {
  let siteId: string;
  let siteSlug: string;

  beforeAll(async () => {
    await db.runMigrations();
    ({ id: siteId, slug: siteSlug } = await db.seedSite("git-export"));
    await db.seedPage(siteId, "home", [
      { id: "b1", type: "hero", props: { heading: "Welcome" } },
    ]);
  });
  afterAll(() => db.teardown());

  it("first export commits all files with the trailer, moves the ref, and records the sha", async () => {
    const client = new FakeGithubClient();
    const result = await exportSite(db.getPool(), siteId, "publish", client);

    expect(result.skipped).toBe(false);
    expect(result.sha).toBeDefined();
    expect(result.files).toBeGreaterThan(0);

    expect(client.createCommitCalls).toHaveLength(1);
    expect(client.createCommitCalls[0].message).toBe(
      `export(${siteSlug}): publish\n\nAnchor-Sync: export`,
    );
    expect(client.updateRefCalls).toEqual([{ branch: "main", sha: result.sha }]);

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_export_sha).toBe(result.sha);
    expect(state?.last_error).toBeNull();

    // Every serialized file + the generated docs got a blob.
    expect(client.createBlobCalls.length).toBe(result.files);
  });

  it("an identical re-export is a no-op: skipped, zero blob/commit calls", async () => {
    const client = new FakeGithubClient();
    await exportSite(db.getPool(), siteId, "publish", client);

    const blobCallsAfterFirst = client.createBlobCalls.length;
    const commitCallsAfterFirst = client.createCommitCalls.length;

    const result = await exportSite(db.getPool(), siteId, "publish", client);

    expect(result.skipped).toBe(true);
    expect(result.sha).toBeUndefined();
    expect(client.createBlobCalls.length).toBe(blobCallsAfterFirst);
    expect(client.createCommitCalls.length).toBe(commitCallsAfterFirst);
    expect(client.updateRefCalls).toHaveLength(1); // still just the first export's move
  });

  it("a changed page produces only the changed blob(s), not a full re-push", async () => {
    const client = new FakeGithubClient();
    await exportSite(db.getPool(), siteId, "publish", client);
    const blobCallsAfterFirst = client.createBlobCalls.length;

    await db.getPool().query(
      `UPDATE pages SET blocks = $2::jsonb WHERE site_id = $1 AND slug = 'home'`,
      [siteId, JSON.stringify([{ id: "b1", type: "hero", props: { heading: "Updated!" } }])],
    );

    const result = await exportSite(db.getPool(), siteId, "manual", client);

    expect(result.skipped).toBe(false);
    // Only pages/home.json changed — README.md, BLOCKS.md, site.json,
    // media.json are all byte-identical to the first export.
    expect(client.createBlobCalls.length).toBe(blobCallsAfterFirst + 1);
    const lastTreeCall = client.createTreeCalls.at(-1)!;
    expect(lastTreeCall.entries).toHaveLength(1);
    expect(lastTreeCall.entries[0].path).toBe(`sites/${siteSlug}/pages/home.json`);
  });

  it("a client error is recorded via recordGitError and rethrown", async () => {
    const client = new ThrowingGithubClient();
    await expect(exportSite(db.getPool(), siteId, "publish", client)).rejects.toThrow(
      /simulated github outage/,
    );

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_error).toContain("simulated github outage");
  });

  // Fix round 1 (Critical): a repo with zero commits 409s on getRefSha
  // ("Git Repository is empty", empirically verified against the live API).
  // Without this bootstrap path, the very first export of a freshly-created
  // content repo (the operator runbook's own starting state) would be
  // permanently stuck.
  it("bootstraps an empty repo: root commit with no parent, createTree with no base tree, createRef (not updateRef)", async () => {
    const client = new FakeGithubClient({ empty: true });
    const result = await exportSite(db.getPool(), siteId, "initial", client);

    expect(result.skipped).toBe(false);
    expect(result.sha).toBeDefined();

    expect(client.createTreeCalls).toHaveLength(1);
    expect(client.createTreeCalls[0].baseTreeSha).toBeNull();

    expect(client.createCommitCalls).toHaveLength(1);
    expect(client.createCommitCalls[0].parentSha).toBeNull();

    expect(client.createRefCalls).toEqual([{ branch: "main", sha: result.sha }]);
    expect(client.updateRefCalls).toHaveLength(0);

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_export_sha).toBe(result.sha);
    expect(state?.last_error).toBeNull();

    // The now-bootstrapped repo takes the normal path on the next export:
    // getRefSha succeeds, and since nothing changed, it's a no-op — no
    // further blob/commit/ref calls at all.
    const blobCallsAfterBootstrap = client.createBlobCalls.length;
    const second = await exportSite(db.getPool(), siteId, "manual", client);
    expect(second.skipped).toBe(true);
    expect(client.createBlobCalls.length).toBe(blobCallsAfterBootstrap);
    expect(client.createRefCalls).toHaveLength(1); // no additional createRef
    expect(client.updateRefCalls).toHaveLength(0); // no-op skip never touches the ref
  });
});
