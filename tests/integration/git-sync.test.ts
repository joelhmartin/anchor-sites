import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAgentDb } from "../helpers/agent-db.js";

import {
  computeGitBlobSha,
  GithubApiError,
  type GithubClient,
  type TreeEntry,
} from "../../src/server/git/client.js";
import { getGitState } from "../../src/server/git/state-repo.js";
import { handleGitExport, type GitExportInput } from "../../src/server/jobs/git-export.js";
import { handleGitImport } from "../../src/server/jobs/git-import.js";
import { adminGitRouter } from "../../src/server/routes/admin-git.js";
import {
  gitWebhookRouter,
  type GitImportInput,
  type RawBodyRequest,
} from "../../src/server/routes/git-webhook.js";
import { adminPagesRouter } from "../../src/server/routes/admin-pages.js";

/**
 * E2E gate (GitHub sync plan, Task 8): the full loop — enable, export,
 * external edit + webhook + import, restore, invalid-block rejection, and
 * loop prevention — driven through the SAME router factories/job handlers
 * production wires together, against ONE shared in-memory fake GithubClient.
 *
 * The fake plays both roles a real GitHub repo would across this test: the
 * exporter's target (blob/tree/commit/ref calls) AND the webhook/import
 * path's source (`getFileAtRef` reads back whatever the exporter — or a
 * simulated external push, built from the SAME client methods a real push
 * would have produced server-side — last committed). Mirrors
 * `src/server/git/export.test.ts`'s fake closely (tree-merge semantics,
 * commit/tree sha bookkeeping) plus `src/server/jobs/git-import.test.ts`'s
 * commit-comment capture, unified so a path written by one call is readable
 * by the next.
 */
class FakeGithubClient implements GithubClient {
  repo = "acme/content";
  branch = "main";
  headSha: string | null = "commit-0";
  private treesByCommitOrTreeSha = new Map<string, TreeEntry[]>([["commit-0", []]]);
  private blobContentBySha = new Map<string, string>();
  private commitCounter = 0;
  private treeCounter = 0;

  createBlobCalls: string[] = [];
  createCommitCalls: { message: string; treeSha: string; parentSha: string | null }[] = [];
  updateRefCalls: { branch: string; sha: string }[] = [];
  commitComments: { sha: string; body: string }[] = [];

  async getDefaultBranch(): Promise<string> {
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

  async getFileAtRef(path: string, ref: string): Promise<string> {
    const tree = this.treesByCommitOrTreeSha.get(ref) ?? [];
    const entry = tree.find((e) => e.path === path && e.type === "blob");
    if (!entry) {
      throw new GithubApiError(
        `github GET /repos/${this.repo}/contents/${path}?ref=${ref} failed: 404 Not Found`,
        404,
      );
    }
    const content = this.blobContentBySha.get(entry.sha);
    if (content === undefined) {
      throw new Error(`fake: no stored content for blob ${entry.sha} at ${path}`);
    }
    return content;
  }

  async createBlob(content: string): Promise<string> {
    const sha = computeGitBlobSha(content);
    this.blobContentBySha.set(sha, content);
    this.createBlobCalls.push(content);
    return sha;
  }

  async createTree(
    baseTreeSha: string | null,
    entries: { path: string; sha: string | null }[],
  ): Promise<string> {
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
    this.updateRefCalls.push({ branch, sha });
    this.headSha = sha;
  }

  async createCommitComment(sha: string, body: string): Promise<void> {
    this.commitComments.push({ sha, body });
  }

  /**
   * Simulates an external push (a human, or Claude Code, editing a file
   * directly in the content repo and pushing) using the SAME client methods
   * the real Git Data API flow uses — createBlob → createTree (based on the
   * current head) → createCommit (parented on the current head) →
   * updateRef. Returns the new head commit sha, which becomes a push
   * payload's `after`.
   */
  async pushExternalEdit(path: string, content: string, message: string): Promise<string> {
    const base = this.headSha;
    const blobSha = await this.createBlob(content);
    const treeSha = await this.createTree(base, [{ path, sha: blobSha }]);
    const commitSha = await this.createCommit(message, treeSha, base);
    await this.updateRef(this.branch, commitSha);
    return commitSha;
  }
}

const WEBHOOK_SECRET = "e2e-test-webhook-secret";
const ADMIN_TOKEN = "e2e-test-admin-token";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

function pushPayload(opts: {
  after: string;
  message: string;
  modified?: string[];
}) {
  return {
    ref: "refs/heads/main",
    after: opts.after,
    repository: { default_branch: "main" },
    commits: [
      {
        message: opts.message,
        added: [],
        modified: opts.modified ?? [],
        removed: [],
      },
    ],
  };
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

d("GitHub sync E2E gate (Task 8)", () => {
  const db = setupAgentDb();

  // handleGitExport/handleGitImport gate on the REAL resolveGitMode()
  // (process.env, not injectable) — vi.stubEnv (not raw `process.env`
  // writes) so vitest's `unstubEnvs` hygiene guarantees these reset before
  // the next test anywhere in the suite, regardless of how long this file's
  // own `afterAll` takes. A raw save/restore pattern here depended on
  // `afterAll` finishing before the next file's hooks ran; when it didn't,
  // the stale values leaked into whichever request was in flight next (root
  // cause of the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("GITHUB_CONTENT_TOKEN", "e2e-content-token");
    vi.stubEnv("GITHUB_CONTENT_REPO", "acme/content");
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  let adminGitApp: express.Express;
  let pagesApp: express.Express;
  let webhookApp: express.Express;
  let enqueueExportSpy: { calls: GitExportInput[] };
  let enqueueImportSpy: { calls: GitImportInput[] };

  beforeAll(async () => {
    await db.runMigrations();

    const pool = db.getPool();

    enqueueExportSpy = { calls: [] };
    const enqueueExport = async (input: GitExportInput) => {
      enqueueExportSpy.calls.push(input);
      return "job-export-1";
    };

    enqueueImportSpy = { calls: [] };
    const enqueueImport = async (input: GitImportInput) => {
      enqueueImportSpy.calls.push(input);
      return "job-import-1";
    };

    adminGitApp = express();
    adminGitApp.use(express.json());
    adminGitApp.use(
      "/api",
      adminGitRouter({
        pool,
        enqueueExport,
        env: { GITHUB_CONTENT_TOKEN: "e2e-content-token", GITHUB_CONTENT_REPO: "acme/content" },
        rateLimit: { max: 200, windowMs: 60_000 },
      }),
    );

    pagesApp = express();
    pagesApp.use(express.json());
    pagesApp.use(
      "/api",
      adminPagesRouter({
        pool,
        saveRateLimit: { max: 200, windowMs: 60_000 },
        // Never actually reached in this suite (every save below stays
        // "draft"), but injected anyway so a stray publish never touches
        // the real pg-boss import path.
        enqueueGitExport: async () => null,
      }),
    );

    webhookApp = express();
    webhookApp.use(
      express.json({
        limit: "1mb",
        verify: (req, _res, buf) => {
          (req as RawBodyRequest).rawBody = buf;
        },
      }),
    );
    webhookApp.use(
      "/api",
      gitWebhookRouter({
        pool,
        enqueueImport,
        env: {
          GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
          GITHUB_CONTENT_TOKEN: "e2e-content-token",
          GITHUB_CONTENT_REPO: "acme/content",
        },
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("runs the full export -> external edit -> webhook -> import -> restore -> reject -> loop-prevention loop", async () => {
    const pool = db.getPool();
    const client = new FakeGithubClient();

    // --- Seed a site + page, and a baseline "manual" revision to restore to later. ---
    const { id: siteId, slug } = await db.seedSite("git-sync-e2e");
    const { id: pageId } = await db.seedPage(siteId, "home", []);

    const originalBlocks = [{ id: "b1", type: "hero", props: { title: "Original" } }];
    const baselineSave = await request(pagesApp)
      .post(`/api/sites/${siteId}/pages/${pageId}`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ blocks: originalBlocks, seo: {}, status: "draft" });
    expect(baselineSave.status).toBe(200);
    const baselineRevisionId = baselineSave.body.revision.id as string;

    // --- Step 1: enable via the admin API (injected enqueue capturing input). ---
    const enableRes = await request(adminGitApp)
      .post(`/api/sites/${siteId}/git/enable`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.state.enabled).toBe(true);
    expect(enqueueExportSpy.calls).toEqual([{ siteId, trigger: "initial" }]);

    // --- Step 2: run the initial export inline with the fake client. ---
    await handleGitExport({ siteId, trigger: "initial" }, { pool, client });

    const stateAfterExport = await getGitState(pool, siteId);
    expect(stateAfterExport?.last_export_sha).toBeTruthy();
    const exportSha = stateAfterExport!.last_export_sha!;

    const exportedTree = await client.getTree(exportSha);
    const exportedPaths = exportedTree.map((e) => e.path).sort();
    expect(exportedPaths).toEqual(
      [
        `sites/${slug}/site.json`,
        `sites/${slug}/pages/home.json`,
        `sites/${slug}/media.json`,
        "README.md",
        "BLOCKS.md",
      ].sort(),
    );
    const exportedPageContent = await client.getFileAtRef(`sites/${slug}/pages/home.json`, exportSha);
    expect(JSON.parse(exportedPageContent).blocks).toEqual(originalBlocks);

    // --- Re-export: no-op skip (zero new commits/blobs). ---
    const blobCallsBeforeReExport = client.createBlobCalls.length;
    const commitCallsBeforeReExport = client.createCommitCalls.length;
    await handleGitExport({ siteId, trigger: "manual" }, { pool, client });
    expect(client.createBlobCalls.length).toBe(blobCallsBeforeReExport);
    expect(client.createCommitCalls.length).toBe(commitCallsBeforeReExport);

    // --- Step 3: mutate the page file directly in the fake repo (external edit) + a real signed push payload. ---
    const editedBlocks = [{ id: "b1", type: "hero", props: { title: "Edited via GitHub" } }];
    const editedPageContent = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: editedBlocks,
    });
    const editCommitSha = await client.pushExternalEdit(
      `sites/${slug}/pages/home.json`,
      editedPageContent,
      "edit home page via GitHub",
    );

    const editPayloadRaw = JSON.stringify(
      pushPayload({
        after: editCommitSha,
        message: "edit home page via GitHub",
        modified: [`sites/${slug}/pages/home.json`],
      }),
    );
    const webhookRes = await request(webhookApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(editPayloadRaw))
      .send(editPayloadRaw);
    expect(webhookRes.status).toBe(202);
    expect(webhookRes.body).toEqual({ queued: [slug] });
    expect(enqueueImportSpy.calls).toHaveLength(1);
    const importInput = enqueueImportSpy.calls[0];
    expect(importInput).toEqual({
      siteId,
      headSha: editCommitSha,
      paths: [`sites/${slug}/pages/home.json`],
    });

    // --- Run the import job inline with the fake client. ---
    await handleGitImport(importInput, { pool, client });

    const pageAfterImport = await pool.query<{ blocks: unknown }>(
      `SELECT blocks FROM pages WHERE id = $1`,
      [pageId],
    );
    expect(pageAfterImport.rows[0].blocks).toEqual(editedBlocks);

    const topRevision = await pool.query<{ source: string }>(
      `SELECT source FROM page_revisions WHERE page_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [pageId],
    );
    expect(topRevision.rows[0].source).toBe(`git:${editCommitSha.slice(0, 7)}`);

    const stateAfterImport = await getGitState(pool, siteId);
    expect(stateAfterImport?.last_import_sha).toBe(editCommitSha);
    expect(stateAfterImport?.last_error).toBeNull();

    // --- Restore round-trip: restoring the pre-import ("manual") revision returns the pre-import blocks. ---
    const restoreRes = await request(pagesApp)
      .post(`/api/sites/${siteId}/pages/${pageId}/revisions/${baselineRevisionId}/restore`)
      .set("X-Admin-Token", ADMIN_TOKEN)
      .send({});
    expect(restoreRes.status).toBe(200);

    const pageAfterRestore = await pool.query<{ blocks: unknown }>(
      `SELECT blocks FROM pages WHERE id = $1`,
      [pageId],
    );
    expect(pageAfterRestore.rows[0].blocks).toEqual(originalBlocks);

    // --- Invalid-block push: page unchanged (still the restored, pre-import content) + a commit comment recorded. ---
    const invalidPageContent = JSON.stringify({
      title: "Home",
      status: "draft",
      seo: {},
      blocks: [{ id: "b1", type: "not-a-real-block", props: {} }],
    });
    const invalidCommitSha = await client.pushExternalEdit(
      `sites/${slug}/pages/home.json`,
      invalidPageContent,
      "bad edit via GitHub",
    );

    const invalidPayloadRaw = JSON.stringify(
      pushPayload({
        after: invalidCommitSha,
        message: "bad edit via GitHub",
        modified: [`sites/${slug}/pages/home.json`],
      }),
    );
    const invalidWebhookRes = await request(webhookApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(invalidPayloadRaw))
      .send(invalidPayloadRaw);
    expect(invalidWebhookRes.status).toBe(202);
    expect(enqueueImportSpy.calls).toHaveLength(2);
    const invalidImportInput = enqueueImportSpy.calls[1];
    expect(invalidImportInput.headSha).toBe(invalidCommitSha);

    await handleGitImport(invalidImportInput, { pool, client });

    const pageAfterInvalid = await pool.query<{ blocks: unknown }>(
      `SELECT blocks FROM pages WHERE id = $1`,
      [pageId],
    );
    expect(pageAfterInvalid.rows[0].blocks).toEqual(originalBlocks);

    expect(client.commitComments).toHaveLength(1);
    expect(client.commitComments[0].sha).toBe(invalidCommitSha);
    expect(client.commitComments[0].body).toContain(`sites/${slug}/pages/home.json`);

    const stateAfterInvalid = await getGitState(pool, siteId);
    // The push AS A WHOLE was processed (sha advances) even though the one
    // file in it failed validation — matches git-import.test.ts's
    // "partially applied" contract.
    expect(stateAfterInvalid?.last_import_sha).toBe(invalidCommitSha);
    expect(stateAfterInvalid?.last_error).toContain(`sites/${slug}/pages/home.json`);

    // --- Export-trailer push: loop prevention — webhook 204s, nothing enqueued. ---
    const trailerPayloadRaw = JSON.stringify(
      pushPayload({
        after: "irrelevant-export-sha",
        message: `export(${slug}): publish\n\nAnchor-Sync: export`,
        modified: [`sites/${slug}/pages/home.json`],
      }),
    );
    const importCallsBeforeTrailer = enqueueImportSpy.calls.length;
    const trailerWebhookRes = await request(webhookApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(trailerPayloadRaw))
      .send(trailerPayloadRaw);
    expect(trailerWebhookRes.status).toBe(204);
    expect(enqueueImportSpy.calls.length).toBe(importCallsBeforeTrailer);
  });
});
