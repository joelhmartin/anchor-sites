import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// Spy on `makeGithubClient` while keeping the real implementation, so tests
// can assert "no client was constructed" for the disabled-mode path without
// mocking away resolveGitMode's real behavior.
const makeGithubClientSpy = vi.fn();
vi.mock("../git/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git/client.js")>();
  return {
    ...actual,
    makeGithubClient: (...args: unknown[]) => {
      makeGithubClientSpy(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.makeGithubClient as any)(...args);
    },
  };
});

import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import { getGitState, setGitEnabled } from "../git/state-repo.js";
import type { GithubClient, TreeEntry } from "../git/client.js";
import { computeGitBlobSha } from "../git/client.js";
import { handleGitExport } from "./git-export.js";

/**
 * Minimal fake client — enough for the exporter to run to completion.
 * Passing the head COMMIT sha as `createTree`'s base tree (rather than a
 * separate tree object sha) mirrors the real client/API — empirically
 * verified against the live API (bot-review fix round 1) that GitHub
 * resolves a commit sha to its tree for both reads and `base_tree` — so this
 * fake keys its tree map by commit sha directly, same as the real thing.
 */
class FakeGithubClient implements GithubClient {
  repo = "acme/content";
  branch = "main";
  headSha = "commit-0";
  private trees = new Map<string, TreeEntry[]>([["commit-0", []]]);
  private counter = 0;
  createCommitCalls: string[] = [];

  async getDefaultBranch() {
    return this.branch;
  }
  async getRefSha() {
    return this.headSha;
  }
  async getTree(sha: string) {
    return this.trees.get(sha) ?? [];
  }
  async getFileAtRef(): Promise<string> {
    throw new Error("not used");
  }
  async createBlob(content: string) {
    return computeGitBlobSha(content);
  }
  async createTree(baseTreeSha: string | null, entries: { path: string; sha: string | null }[]) {
    const base = baseTreeSha !== null ? this.trees.get(baseTreeSha) ?? [] : [];
    const merged = new Map(base.map((e) => [e.path, e] as const));
    for (const e of entries) {
      if (e.sha === null) merged.delete(e.path);
      else merged.set(e.path, { path: e.path, sha: e.sha, type: "blob" });
    }
    const treeSha = `tree-${++this.counter}`;
    this.trees.set(treeSha, [...merged.values()]);
    return treeSha;
  }
  async createCommit(message: string, treeSha: string, _parentSha: string | null) {
    this.createCommitCalls.push(message);
    const commitSha = `commit-${++this.counter}`;
    this.trees.set(commitSha, this.trees.get(treeSha) ?? []);
    return commitSha;
  }
  async updateRef(_branch: string, sha: string) {
    this.headSha = sha;
  }
  async createRef(_branch: string, sha: string) {
    this.headSha = sha;
  }
  async createCommitComment() {
    /* no-op */
  }
}

function withEnvSnapshot() {
  const originalToken = process.env.GITHUB_CONTENT_TOKEN;
  const originalRepo = process.env.GITHUB_CONTENT_REPO;
  return () => {
    if (originalToken === undefined) delete process.env.GITHUB_CONTENT_TOKEN;
    else process.env.GITHUB_CONTENT_TOKEN = originalToken;
    if (originalRepo === undefined) delete process.env.GITHUB_CONTENT_REPO;
    else process.env.GITHUB_CONTENT_REPO = originalRepo;
  };
}

describe("handleGitExport — disabled mode", () => {
  const restoreEnv = withEnvSnapshot();

  afterEach(() => {
    makeGithubClientSpy.mockClear();
    restoreEnv();
  });

  it("returns silently, never constructing a client, when git sync mode is disabled", async () => {
    delete process.env.GITHUB_CONTENT_TOKEN;
    delete process.env.GITHUB_CONTENT_REPO;

    await handleGitExport({ siteId: "irrelevant-site-id", trigger: "publish" }, { pool: {} as Pool });

    expect(makeGithubClientSpy).not.toHaveBeenCalled();
  });
});

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("handleGitExport — enabled-state gating + exporter run", () => {
  const restoreEnv = withEnvSnapshot();

  beforeAll(async () => {
    await db.runMigrations();
    process.env.GITHUB_CONTENT_TOKEN = "tok123";
    process.env.GITHUB_CONTENT_REPO = "acme/content";
  });

  afterAll(async () => {
    await db.teardown();
    restoreEnv();
  });

  afterEach(() => {
    makeGithubClientSpy.mockClear();
  });

  it("runs the exporter end-to-end when the site's git state is enabled, using the injected client", async () => {
    const { id: siteId } = await db.seedSite("git-export-job-enabled");
    await db.seedPage(siteId, "home", [{ id: "b1", type: "hero", props: {} }]);
    await setGitEnabled(db.getPool(), siteId, true);

    const client = new FakeGithubClient();
    await handleGitExport({ siteId, trigger: "initial" }, { pool: db.getPool(), client });

    expect(client.createCommitCalls).toHaveLength(1);
    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_export_sha).toBeDefined();
    // deps.client was supplied — the real client must never be constructed.
    expect(makeGithubClientSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the site's git state row exists but is disabled", async () => {
    const { id: siteId } = await db.seedSite("git-export-job-disabled");
    await setGitEnabled(db.getPool(), siteId, false);

    const client = new FakeGithubClient();
    await handleGitExport({ siteId, trigger: "publish" }, { pool: db.getPool(), client });

    expect(client.createCommitCalls).toHaveLength(0);
  });

  it("does nothing when the site has no git state row at all", async () => {
    const { id: siteId } = await db.seedSite("git-export-job-none");

    const client = new FakeGithubClient();
    await handleGitExport({ siteId, trigger: "publish" }, { pool: db.getPool(), client });

    expect(client.createCommitCalls).toHaveLength(0);
  });
});
