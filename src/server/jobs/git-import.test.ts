import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// Spy on `makeGithubClient` while keeping the real implementation (mirrors
// git-export.test.ts) so the disabled-mode test can assert no client was
// ever constructed without mocking away resolveGitMode's real behavior.
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
import { GithubApiError, type GithubClient, type TreeEntry } from "../git/client.js";
import { handleGitImport } from "./git-import.js";
import type { GitImportInput } from "../routes/git-webhook.js";

/**
 * Minimal fake client: canned `getFileAtRef` contents + a comment spy.
 * `notFoundPaths` (fix round 1, Important 1) makes `getFileAtRef` throw a
 * REAL `GithubApiError({status: 404})` for a specific path, distinct from
 * the generic `Error` thrown when a test simply forgot to seed a fixture —
 * the former exercises the 404-tolerant path in `git-import.ts`, the latter
 * is treated as an unexpected fetch error (propagates + rethrows) by design.
 */
class FakeGithubClient implements GithubClient {
  repo = "acme/content";
  commitComments: { sha: string; body: string }[] = [];
  private files: Map<string, string>;
  private notFoundPaths: Set<string>;

  constructor(files: Record<string, string> = {}, notFoundPaths: string[] = []) {
    this.files = new Map(Object.entries(files));
    this.notFoundPaths = new Set(notFoundPaths);
  }

  async getDefaultBranch(): Promise<string> {
    throw new Error("not used");
  }
  async getRefSha(): Promise<string> {
    throw new Error("not used");
  }
  async getTree(): Promise<TreeEntry[]> {
    throw new Error("not used");
  }
  async getFileAtRef(path: string): Promise<string> {
    if (this.notFoundPaths.has(path)) {
      throw new GithubApiError(`github GET /repos/acme/content/contents/${path} failed: 404 Not Found`, 404);
    }
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`fixture missing content for ${path}`);
    return content;
  }
  async createBlob(): Promise<string> {
    throw new Error("not used");
  }
  async createTree(): Promise<string> {
    throw new Error("not used");
  }
  async createCommit(): Promise<string> {
    throw new Error("not used");
  }
  async updateRef(): Promise<void> {
    throw new Error("not used");
  }
  async createRef(): Promise<void> {
    throw new Error("not used");
  }
  async createCommitComment(sha: string, body: string): Promise<void> {
    this.commitComments.push({ sha, body });
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

describe("handleGitImport — disabled mode", () => {
  const restoreEnv = withEnvSnapshot();

  afterEach(() => {
    makeGithubClientSpy.mockClear();
    restoreEnv();
  });

  it("returns silently, never constructing a client, when git sync mode is disabled", async () => {
    delete process.env.GITHUB_CONTENT_TOKEN;
    delete process.env.GITHUB_CONTENT_REPO;

    await handleGitImport(
      { siteId: "irrelevant-site-id", headSha: "sha0", paths: [] },
      { pool: {} as Pool },
    );

    expect(makeGithubClientSpy).not.toHaveBeenCalled();
  });
});

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("handleGitImport — validated apply + reporting", () => {
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

  it("applies a valid page edit: blocks change, one git:<sha7> revision, status honored", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-valid");
    const { id: pageId } = await db.seedPage(siteId, "home", [
      { id: "b1", type: "hero", props: { title: "Old" } },
    ]);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const pageJson = JSON.stringify({
      title: "New Home",
      status: "published",
      seo: {},
      blocks: [{ id: "b1", type: "hero", props: { title: "New" } }],
    });
    const client = new FakeGithubClient({ [path]: pageJson });
    const getSpy = vi.spyOn(client, "getFileAtRef");

    const input: GitImportInput = { siteId, headSha: "abc1234567890", paths: [path] };
    await handleGitImport(input, { pool: db.getPool(), client });

    const pageRow = await db.getPool().query(
      `SELECT blocks, status, title FROM pages WHERE id = $1`,
      [pageId],
    );
    expect(pageRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: { title: "New" } }]);
    expect(pageRow.rows[0].status).toBe("published");
    expect(pageRow.rows[0].title).toBe("New Home");

    const revRes = await db.getPool().query(
      `SELECT source FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [pageId],
    );
    expect(revRes.rows[0].source).toBe("git:abc1234");

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_import_sha).toBe("abc1234567890");
    expect(state?.last_error).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(client.commitComments).toHaveLength(0);
  });

  it("rejects an unknown block type: page unchanged, error recorded, comment mentions the path", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-badtype");
    const original = [{ id: "b1", type: "hero", props: { title: "Original" } }];
    const { id: pageId } = await db.seedPage(siteId, "home", original);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const badJson = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "not-a-real-block", props: {} }],
    });
    const client = new FakeGithubClient({ [path]: badJson });

    await handleGitImport({ siteId, headSha: "bad0000001", paths: [path] }, { pool: db.getPool(), client });

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [pageId]);
    expect(pageRow.rows[0].blocks).toEqual(original);

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_import_sha).toBe("bad0000001");
    expect(state?.last_error).toContain(path);

    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain(path);
  });

  it("rejects a page referencing an unknown media asset id", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-badasset");
    const original = [{ id: "b1", type: "hero", props: {} }];
    const { id: pageId } = await db.seedPage(siteId, "home", original);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const missingAssetId = "00000000-0000-0000-0000-000000000000";
    const badJson = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "image", props: { asset_id: missingAssetId } }],
    });
    const client = new FakeGithubClient({ [path]: badJson });

    await handleGitImport({ siteId, headSha: "asset000001", paths: [path] }, { pool: db.getPool(), client });

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [pageId]);
    expect(pageRow.rows[0].blocks).toEqual(original);

    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain(path);
    expect(client.commitComments[0].body).toContain(missingAssetId);
  });

  it("creates a brand-new page file with a revision", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-newpage");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/about.json`;
    const newPageJson = JSON.stringify({
      title: "About",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "hero", props: { title: "About us" } }],
    });
    const client = new FakeGithubClient({ [path]: newPageJson });

    await handleGitImport({ siteId, headSha: "new0000001", paths: [path] }, { pool: db.getPool(), client });

    const pageRes = await db.getPool().query<{ id: string; title: string }>(
      `SELECT id, title FROM pages WHERE site_id = $1 AND slug = $2`,
      [siteId, "about"],
    );
    expect(pageRes.rowCount).toBe(1);
    expect(pageRes.rows[0].title).toBe("About");

    const revRes = await db.getPool().query(
      `SELECT source FROM page_revisions WHERE page_id = $1`,
      [pageRes.rows[0].id],
    );
    expect(revRes.rows[0].source).toBe("git:new0000");
  });

  it("site.json: brand tokens replaced, seo defaults shallow-merged (pre-existing key preserved)", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-site");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);
    await db.getPool().query(
      `UPDATE sites SET default_brand_tokens = $1::jsonb, seo_defaults = $2::jsonb WHERE id = $3`,
      [
        JSON.stringify({ "--theme-old": "#111111" }),
        JSON.stringify({ titleTemplate: "%s | Old", twitterHandle: "@old" }),
        siteId,
      ],
    );

    const path = `sites/${slug}/site.json`;
    const siteJson = JSON.stringify({
      display_name: "New Display Name",
      default_brand_tokens: { "--theme-main": "#123456" },
      seo_defaults: { titleTemplate: "%s | New" },
    });
    const client = new FakeGithubClient({ [path]: siteJson });

    await handleGitImport({ siteId, headSha: "site0000001", paths: [path] }, { pool: db.getPool(), client });

    const siteRow = await db.getPool().query<{
      default_brand_tokens: Record<string, string>;
      seo_defaults: Record<string, unknown>;
    }>(`SELECT default_brand_tokens, seo_defaults FROM sites WHERE id = $1`, [siteId]);

    expect(siteRow.rows[0].default_brand_tokens).toEqual({ "--theme-main": "#123456" });
    expect(siteRow.rows[0].seo_defaults).toEqual({
      titleTemplate: "%s | New",
      twitterHandle: "@old",
    });
    expect(client.commitComments).toHaveLength(0);
  });

  it("reports a removed path in the comment without deleting the page", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-removed");
    const { id: pageId } = await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const client = new FakeGithubClient();
    const getSpy = vi.spyOn(client, "getFileAtRef");

    await handleGitImport(
      { siteId, headSha: "removed001", paths: [`REMOVED:${path}`] },
      { pool: db.getPool(), client },
    );

    const pageRow = await db.getPool().query(`SELECT id FROM pages WHERE id = $1`, [pageId]);
    expect(pageRow.rowCount).toBe(1);

    expect(getSpy).not.toHaveBeenCalled();
    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain("pages/home.json");
  });

  it("notes a media.json edit as ignored", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-mediajson");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/media.json`;
    const client = new FakeGithubClient();
    const getSpy = vi.spyOn(client, "getFileAtRef");

    await handleGitImport({ siteId, headSha: "media00001", paths: [path] }, { pool: db.getPool(), client });

    expect(getSpy).not.toHaveBeenCalled();
    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain("media.json");
  });

  it("no-ops on a redelivery of the same headSha (client not called)", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-idempotent");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const pageJson = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: [],
    });
    const client = new FakeGithubClient({ [path]: pageJson });
    const input: GitImportInput = { siteId, headSha: "same0000001", paths: [path] };

    await handleGitImport(input, { pool: db.getPool(), client });

    const getSpy = vi.spyOn(client, "getFileAtRef");
    await handleGitImport(input, { pool: db.getPool(), client });

    expect(getSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the site's git state is disabled", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-disabled");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, false);

    const path = `sites/${slug}/pages/home.json`;
    const client = new FakeGithubClient({ [path]: "{}" });
    const getSpy = vi.spyOn(client, "getFileAtRef");

    await handleGitImport({ siteId, headSha: "disabled001", paths: [path] }, { pool: db.getPool(), client });

    expect(getSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the site has no git state row at all", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-nostate");
    await db.seedPage(siteId, "home", []);

    const path = `sites/${slug}/pages/home.json`;
    const client = new FakeGithubClient({ [path]: "{}" });
    const getSpy = vi.spyOn(client, "getFileAtRef");

    await handleGitImport({ siteId, headSha: "nostate001", paths: [path] }, { pool: db.getPool(), client });

    expect(getSpy).not.toHaveBeenCalled();
  });

  // --- Fix round 1 (bot review) -------------------------------------------

  it("Important 1: treats a 404 from getFileAtRef as a per-file failure (edit-then-delete race) — other files in the same push still apply", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-404");
    const { id: pageId } = await db.seedPage(siteId, "home", [
      { id: "b1", type: "hero", props: { title: "Old" } },
    ]);
    await setGitEnabled(db.getPool(), siteId, true);

    const validPath = `sites/${slug}/pages/home.json`;
    const deletedLaterPath = `sites/${slug}/pages/gone.json`;
    const pageJson = JSON.stringify({
      title: "New",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "hero", props: { title: "New" } }],
    });
    const client = new FakeGithubClient({ [validPath]: pageJson }, [deletedLaterPath]);

    await handleGitImport(
      { siteId, headSha: "race0000001", paths: [validPath, deletedLaterPath] },
      { pool: db.getPool(), client },
    );

    const pageRow = await db.getPool().query(`SELECT blocks FROM pages WHERE id = $1`, [pageId]);
    expect(pageRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: { title: "New" } }]);

    const state = await getGitState(db.getPool(), siteId);
    // recordImport still advances the sha — the push AS A WHOLE was
    // processed even though one file 404'd.
    expect(state?.last_import_sha).toBe("race0000001");

    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain(deletedLaterPath);
    expect(client.commitComments[0].body).toContain("deleted later in push");
  });

  it("Important 2a: caps the commit-comment body to the first 20 failures + a remainder note", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-capped");
    await setGitEnabled(db.getPool(), siteId, true);

    const paths: string[] = [];
    const files: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      const p = `sites/${slug}/pages/bad-${i}.json`;
      paths.push(p);
      files[p] = JSON.stringify({
        title: `Bad ${i}`,
        status: "draft",
        seo: {},
        blocks: [{ id: "b1", type: "not-a-real-block", props: {} }],
      });
    }
    const client = new FakeGithubClient(files);

    await handleGitImport({ siteId, headSha: "cap0000001", paths }, { pool: db.getPool(), client });

    expect(client.commitComments).toHaveLength(1);
    const body = client.commitComments[0].body;
    expect(body).toContain("bad-19.json"); // 20th item (0-indexed) — shown
    expect(body).not.toContain("bad-20.json"); // 21st item — capped out
    expect(body).toContain("…and 5 more");
  });

  it("Important 2b: downgrades a createCommitComment failure to a warning, keeping the validation summary (not the HTTP error) as last_error", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-commentfail");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    const path = `sites/${slug}/pages/home.json`;
    const badJson = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "not-a-real-block", props: {} }],
    });
    const client = new FakeGithubClient({ [path]: badJson });
    vi.spyOn(client, "createCommitComment").mockRejectedValue(
      new Error("422 Unprocessable Entity: body is too long"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      handleGitImport({ siteId, headSha: "cmt0000001", paths: [path] }, { pool: db.getPool(), client }),
    ).resolves.toBeUndefined();

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_import_sha).toBe("cmt0000001");
    expect(state?.last_error).toContain(path);
    expect(state?.last_error).not.toContain("422");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("accumulates failures and continues: a mixed valid+invalid batch applies the valid file and reports the invalid one", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-mixed");
    const { id: pageId } = await db.seedPage(siteId, "home", [
      { id: "b1", type: "hero", props: { title: "Old" } },
    ]);
    await setGitEnabled(db.getPool(), siteId, true);

    const validPath = `sites/${slug}/pages/home.json`;
    const invalidPath = `sites/${slug}/pages/broken.json`;
    const validJson = JSON.stringify({
      title: "New Home",
      status: "published",
      seo: {},
      blocks: [{ id: "b1", type: "hero", props: { title: "New" } }],
    });
    const invalidJson = JSON.stringify({
      title: "Broken",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "not-a-real-block", props: {} }],
    });
    const client = new FakeGithubClient({ [validPath]: validJson, [invalidPath]: invalidJson });

    await handleGitImport(
      { siteId, headSha: "mixed00001", paths: [validPath, invalidPath] },
      { pool: db.getPool(), client },
    );

    const pageRow = await db.getPool().query(
      `SELECT blocks, status FROM pages WHERE id = $1`,
      [pageId],
    );
    expect(pageRow.rows[0].blocks).toEqual([{ id: "b1", type: "hero", props: { title: "New" } }]);
    expect(pageRow.rows[0].status).toBe("published");

    const state = await getGitState(db.getPool(), siteId);
    expect(state?.last_import_sha).toBe("mixed00001");
    expect(state?.last_error).toContain(invalidPath);

    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].body).toContain(invalidPath);
  });

  it("a genuine fetch error (not a 404) records the error and rethrows for pg-boss retry, without advancing last_import_sha", async () => {
    const { id: siteId, slug } = await db.seedSite("git-import-fetcherror");
    await db.seedPage(siteId, "home", []);
    await setGitEnabled(db.getPool(), siteId, true);

    // No fixture content seeded for this path — FakeGithubClient throws a
    // plain Error (not a GithubApiError), simulating a network/5xx failure
    // distinct from the 404-tolerant path above.
    const path = `sites/${slug}/pages/home.json`;
    const client = new FakeGithubClient({});

    await expect(
      handleGitImport({ siteId, headSha: "fetcherr001", paths: [path] }, { pool: db.getPool(), client }),
    ).rejects.toThrow(/fixture missing content/);

    const state = await getGitState(db.getPool(), siteId);
    // The job threw before recordImport ran — the sha never advanced.
    expect(state?.last_import_sha).not.toBe("fetcherr001");
    expect(state?.last_error).toContain("fixture missing content");
  });
});
