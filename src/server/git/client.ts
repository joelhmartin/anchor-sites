/**
 * GitHub Git Data API client for the content-monorepo sync (GitHub Sync plan,
 * Task 2). Injectable `fetch` (style mirrors src/server/media/pixabay.ts) so
 * tests never touch the network.
 *
 * Mode selection mirrors src/server/ai/config.ts's `resolveAiMode` (D-038):
 * an unset token/repo means "disabled" for local dev + CI, and the literal
 * value `"disabled"` is a placeholder-secret sentinel — Task 8 seeds
 * GITHUB_CONTENT_TOKEN with that value in Secret Manager before the operator
 * adds a real PAT, so deploys stay green (mode stays disabled) in the
 * meantime rather than flipping to "api" with a bogus token.
 */
import { createHash } from "node:crypto";

export type GitMode = "disabled" | "api";

export function resolveGitMode(env: NodeJS.ProcessEnv = process.env): GitMode {
  const token = env.GITHUB_CONTENT_TOKEN;
  const repo = env.GITHUB_CONTENT_REPO;
  if (!token || token === "disabled" || !repo) return "disabled";
  return "api";
}

export type TreeEntry = { path: string; sha: string; type: "blob" | "tree" };

export type GithubClient = {
  repo: string;
  getDefaultBranch(): Promise<string>;
  getRefSha(branch: string): Promise<string>;
  getTree(sha: string): Promise<TreeEntry[]>;
  getFileAtRef(path: string, ref: string): Promise<string>;
  createBlob(content: string): Promise<string>;
  // `baseTreeSha: null` → no `base_tree` in the request (a brand-new root
  // tree) — the empty-repo bootstrap path (export.ts) needs this: a repo
  // with zero commits has no tree to base off of.
  createTree(
    baseTreeSha: string | null,
    entries: { path: string; sha: string | null }[],
  ): Promise<string>;
  // `parentSha: null` → `parents: []` — the empty-repo bootstrap's root
  // commit has no parent.
  createCommit(message: string, treeSha: string, parentSha: string | null): Promise<string>;
  updateRef(branch: string, sha: string): Promise<void>;
  // POST .../git/refs — creates a ref that doesn't exist yet. Needed for the
  // empty-repo bootstrap path, where `updateRef`'s PATCH would 404/422 (there
  // is no `refs/heads/<branch>` to update yet).
  createRef(branch: string, sha: string): Promise<void>;
  createCommitComment(sha: string, body: string): Promise<void>;
};

const API_BASE = "https://api.github.com";
const RETRY_WAIT_CAP_MS = 10_000;

/**
 * Thrown by every non-2xx GitHub response, carrying the HTTP status so
 * callers can branch on specific codes (export.ts's empty-repo bootstrap
 * detects 409 from `getRefSha` this way) instead of pattern-matching the
 * error message.
 */
export class GithubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

/** `sha1("blob " + byteLength + "\0" + content)` — same hash git uses for blob object ids. */
export function computeGitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, bytes])).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeGithubClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): GithubClient {
  if (resolveGitMode(env) === "disabled") {
    throw new Error(
      "github client disabled: set GITHUB_CONTENT_TOKEN + GITHUB_CONTENT_REPO to enable",
    );
  }
  const token = env.GITHUB_CONTENT_TOKEN as string;
  const repo = env.GITHUB_CONTENT_REPO as string;

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let res = await fetchFn(url, init);
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        const waitMs = Math.min(
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
          RETRY_WAIT_CAP_MS,
        );
        await sleep(waitMs);
        res = await fetchFn(url, init);
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GithubApiError(
        `github ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
      );
    }
    return res;
  }

  return {
    repo,

    async getDefaultBranch(): Promise<string> {
      const res = await request("GET", `/repos/${repo}`);
      const body = (await res.json()) as { default_branch: string };
      return body.default_branch;
    },

    async getRefSha(branch: string): Promise<string> {
      const res = await request("GET", `/repos/${repo}/git/ref/heads/${branch}`);
      const body = (await res.json()) as { object: { sha: string } };
      return body.object.sha;
    },

    async getTree(sha: string): Promise<TreeEntry[]> {
      const res = await request("GET", `/repos/${repo}/git/trees/${sha}?recursive=1`);
      const body = (await res.json()) as {
        truncated: boolean;
        tree: { path: string; sha: string; type: string }[];
      };
      if (body.truncated) {
        throw new Error(`github tree truncated for sha ${sha} (recursive listing incomplete)`);
      }
      return body.tree
        .filter((entry): entry is { path: string; sha: string; type: "blob" | "tree" } =>
          entry.type === "blob" || entry.type === "tree",
        )
        .map((entry) => ({ path: entry.path, sha: entry.sha, type: entry.type }));
    },

    async getFileAtRef(path: string, ref: string): Promise<string> {
      const res = await request(
        "GET",
        `/repos/${repo}/contents/${path}?ref=${ref}`,
      );
      const body = (await res.json()) as { content: string; encoding: string };
      return Buffer.from(body.content, "base64").toString("utf8");
    },

    async createBlob(content: string): Promise<string> {
      const res = await request("POST", `/repos/${repo}/git/blobs`, {
        content,
        encoding: "utf-8",
      });
      const body = (await res.json()) as { sha: string };
      return body.sha;
    },

    async createTree(
      baseTreeSha: string | null,
      entries: { path: string; sha: string | null }[],
    ): Promise<string> {
      const res = await request("POST", `/repos/${repo}/git/trees`, {
        ...(baseTreeSha !== null ? { base_tree: baseTreeSha } : {}),
        tree: entries.map((entry) => ({
          path: entry.path,
          mode: "100644",
          type: "blob",
          sha: entry.sha,
        })),
      });
      const body = (await res.json()) as { sha: string };
      return body.sha;
    },

    async createCommit(
      message: string,
      treeSha: string,
      parentSha: string | null,
    ): Promise<string> {
      const res = await request("POST", `/repos/${repo}/git/commits`, {
        message,
        tree: treeSha,
        parents: parentSha !== null ? [parentSha] : [],
      });
      const body = (await res.json()) as { sha: string };
      return body.sha;
    },

    async updateRef(branch: string, sha: string): Promise<void> {
      await request("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, {
        sha,
        force: false,
      });
    },

    async createRef(branch: string, sha: string): Promise<void> {
      await request("POST", `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha,
      });
    },

    async createCommitComment(sha: string, body: string): Promise<void> {
      await request("POST", `/repos/${repo}/commits/${sha}/comments`, { body });
    },
  };
}
