import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveGitMode,
  makeGithubClient,
  computeGitBlobSha,
  GithubApiError,
} from "./client.js";

function fetchOk(body: unknown, extra: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    ...extra,
  } as unknown as Response;
}

function fetchFail(status: number, body = "", retryAfter: string | null = null) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => JSON.parse(body || "{}"),
    text: async () => body,
  } as unknown as Response;
}

const ENV_ENABLED = { GITHUB_CONTENT_TOKEN: "tok123", GITHUB_CONTENT_REPO: "acme/content" } as NodeJS.ProcessEnv;

describe("resolveGitMode", () => {
  it("is disabled when nothing is set", () => {
    expect(resolveGitMode({} as NodeJS.ProcessEnv)).toBe("disabled");
  });

  it("is disabled when token is set but repo is missing", () => {
    expect(resolveGitMode({ GITHUB_CONTENT_TOKEN: "tok123" } as NodeJS.ProcessEnv)).toBe("disabled");
  });

  it("is disabled when repo is set but token is missing", () => {
    expect(resolveGitMode({ GITHUB_CONTENT_REPO: "acme/content" } as NodeJS.ProcessEnv)).toBe("disabled");
  });

  it("is disabled when repo is an empty string", () => {
    expect(
      resolveGitMode({ GITHUB_CONTENT_TOKEN: "tok123", GITHUB_CONTENT_REPO: "" } as NodeJS.ProcessEnv),
    ).toBe("disabled");
  });

  // Task 8 Step 3 contract: the placeholder-secret sentinel value "disabled"
  // (mirroring ANTHROPIC_API_KEY's "dry-run" convention in src/server/ai/config.ts)
  // must resolve to disabled even when GITHUB_CONTENT_REPO is populated — this
  // keeps `gcloud secrets create ... --data-file=<(echo disabled)` deploy-safe.
  it("is disabled when the token is the literal placeholder sentinel 'disabled', even with a repo set", () => {
    expect(
      resolveGitMode({
        GITHUB_CONTENT_TOKEN: "disabled",
        GITHUB_CONTENT_REPO: "acme/content",
      } as NodeJS.ProcessEnv),
    ).toBe("disabled");
  });

  it("is api when both token and repo are set to real values", () => {
    expect(resolveGitMode(ENV_ENABLED)).toBe("api");
  });
});

describe("makeGithubClient", () => {
  it("throws when mode is disabled", () => {
    expect(() => makeGithubClient({} as NodeJS.ProcessEnv)).toThrow();
  });

  it("throws when the token is the 'disabled' sentinel", () => {
    expect(() =>
      makeGithubClient({
        GITHUB_CONTENT_TOKEN: "disabled",
        GITHUB_CONTENT_REPO: "acme/content",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("exposes the configured repo", () => {
    const fetchFn = vi.fn();
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    expect(client.repo).toBe("acme/content");
  });
});

describe("computeGitBlobSha", () => {
  it("matches the known git blob sha1 fixture", () => {
    expect(computeGitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("is sensitive to content changes", () => {
    expect(computeGitBlobSha("hello")).not.toBe(computeGitBlobSha("hello\n"));
  });
});

describe("makeGithubClient request methods", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function commonHeaderAssertions(call: unknown[]) {
    const [url, init] = call as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok123");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    return url;
  }

  it("getDefaultBranch: GET /repos/{repo} → default_branch", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ default_branch: "main" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const branch = await client.getDefaultBranch();
    expect(branch).toBe("main");
    const url = commonHeaderAssertions(fetchFn.mock.calls[0]);
    expect(url).toBe("https://api.github.com/repos/acme/content");
    expect((fetchFn.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("getRefSha: GET /repos/{repo}/git/ref/heads/{branch} → object.sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ object: { sha: "abc123" } }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.getRefSha("main");
    expect(sha).toBe("abc123");
    const url = commonHeaderAssertions(fetchFn.mock.calls[0]);
    expect(url).toBe("https://api.github.com/repos/acme/content/git/ref/heads/main");
  });

  it("getTree: GET .../git/trees/{sha}?recursive=1 → TreeEntry[]", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      fetchOk({
        sha: "treeSha",
        truncated: false,
        tree: [
          { path: "sites/foo/site.json", mode: "100644", type: "blob", sha: "s1" },
          { path: "sites/foo", mode: "040000", type: "tree", sha: "s2" },
        ],
      }),
    );
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const entries = await client.getTree("treeSha");
    expect(entries).toEqual([
      { path: "sites/foo/site.json", sha: "s1", type: "blob" },
      { path: "sites/foo", sha: "s2", type: "tree" },
    ]);
    const url = commonHeaderAssertions(fetchFn.mock.calls[0]);
    expect(url).toBe("https://api.github.com/repos/acme/content/git/trees/treeSha?recursive=1");
  });

  it("getTree: flags truncated:true as an error", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "treeSha", truncated: true, tree: [] }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    await expect(client.getTree("treeSha")).rejects.toThrow(/truncat/i);
  });

  it("getFileAtRef: GET .../contents/{path}?ref= → base64 decodes content", async () => {
    const encoded = Buffer.from("hello\n", "utf8").toString("base64");
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ content: encoded, encoding: "base64" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const content = await client.getFileAtRef("pages/home.json", "deadbeef");
    expect(content).toBe("hello\n");
    const url = commonHeaderAssertions(fetchFn.mock.calls[0]);
    expect(url).toBe(
      "https://api.github.com/repos/acme/content/contents/pages/home.json?ref=deadbeef",
    );
  });

  it("getFileAtRef: tolerates GitHub's newline-wrapped base64 content", async () => {
    const raw = Buffer.from("hello\n", "utf8").toString("base64");
    const wrapped = raw.match(/.{1,4}/g)!.join("\n") + "\n";
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ content: wrapped, encoding: "base64" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const content = await client.getFileAtRef("pages/home.json", "deadbeef");
    expect(content).toBe("hello\n");
  });

  it("createBlob: POST .../git/blobs with content, returns sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "blobSha1" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.createBlob("hello\n");
    expect(sha).toBe("blobSha1");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    commonHeaderAssertions(fetchFn.mock.calls[0]);
    expect(url).toBe("https://api.github.com/repos/acme/content/git/blobs");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ content: "hello\n", encoding: "utf-8" });
  });

  it("createTree: POST .../git/trees with base_tree + entries, returns sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "newTreeSha" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.createTree("baseTreeSha", [
      { path: "sites/foo/site.json", sha: "blobSha1" },
      { path: "sites/foo/pages/gone.json", sha: null },
    ]);
    expect(sha).toBe("newTreeSha");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/content/git/trees");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.base_tree).toBe("baseTreeSha");
    expect(body.tree).toEqual([
      { path: "sites/foo/site.json", mode: "100644", type: "blob", sha: "blobSha1" },
      { path: "sites/foo/pages/gone.json", mode: "100644", type: "blob", sha: null },
    ]);
  });

  // Fix round 1 (Critical, empty-repo bootstrap): a repo with zero commits
  // has no tree to base a new one off of — `baseTreeSha: null` must omit
  // `base_tree` entirely so GitHub creates a brand-new root tree.
  it("createTree: baseTreeSha null omits base_tree from the request body", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "rootTreeSha" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.createTree(null, [{ path: "site.json", sha: "blobSha1" }]);
    expect(sha).toBe("rootTreeSha");
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("base_tree");
    expect(body.tree).toEqual([
      { path: "site.json", mode: "100644", type: "blob", sha: "blobSha1" },
    ]);
  });

  it("createCommit: POST .../git/commits with message/tree/parents, returns sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "commitSha1" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.createCommit("export(foo): publish\n\nAnchor-Sync: export", "treeSha1", "parentSha1");
    expect(sha).toBe("commitSha1");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/content/git/commits");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      message: "export(foo): publish\n\nAnchor-Sync: export",
      tree: "treeSha1",
      parents: ["parentSha1"],
    });
  });

  // Fix round 1 (Critical, empty-repo bootstrap): the root commit of a
  // brand-new repo has no parent — `parentSha: null` must produce `parents:
  // []`, not `[null]`.
  it("createCommit: parentSha null produces parents: []", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({ sha: "rootCommitSha" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    const sha = await client.createCommit("export(foo): initial\n\nAnchor-Sync: export", "treeSha1", null);
    expect(sha).toBe("rootCommitSha");
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      message: "export(foo): initial\n\nAnchor-Sync: export",
      tree: "treeSha1",
      parents: [],
    });
  });

  it("updateRef: PATCH .../git/refs/heads/{branch} with sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({}));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    await client.updateRef("main", "commitSha1");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/content/git/refs/heads/main");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ sha: "commitSha1", force: false });
  });

  // Fix round 1 (Critical, empty-repo bootstrap): a repo with zero commits
  // has no `refs/heads/<branch>` for `updateRef`'s PATCH to move — `createRef`
  // (POST .../git/refs) creates it instead.
  it("createRef: POST .../git/refs with ref+sha", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({}));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    await client.createRef("main", "rootCommitSha");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/content/git/refs");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ ref: "refs/heads/main", sha: "rootCommitSha" });
  });

  it("createCommitComment: POST .../commits/{sha}/comments with body", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchOk({}));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    await client.createCommitComment("commitSha1", "3 files failed validation");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/content/commits/commitSha1/comments");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ body: "3 files failed validation" });
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => fetchFail(404, "Not Found"));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    await expect(client.getDefaultBranch()).rejects.toThrow(
      /github GET \/repos\/acme\/content failed: 404 Not Found/,
    );
  });

  // Fix round 1 (Critical): export.ts's empty-repo bootstrap branches on the
  // HTTP status specifically (409 = "Git Repository is empty"), not on
  // pattern-matching the error message — this is what makes that possible.
  it("throws a GithubApiError carrying the HTTP status", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      fetchFail(409, "Git Repository is empty"),
    );
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);
    let caught: unknown;
    try {
      await client.getRefSha("main");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GithubApiError);
    expect((caught as GithubApiError).status).toBe(409);
    expect((caught as GithubApiError).message).toMatch(/failed: 409/);
  });

  it("honors Retry-After once with a bounded wait, then retries and succeeds", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fetchFail(403, "secondary rate limit", "2"))
      .mockResolvedValueOnce(fetchOk({ default_branch: "main" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);

    const promise = client.getDefaultBranch();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe("main");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("bounds the Retry-After wait to 10s even if the header asks for longer", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fetchFail(403, "secondary rate limit", "9999"))
      .mockResolvedValueOnce(fetchOk({ default_branch: "main" }));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);

    const promise = client.getDefaultBranch();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe("main");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws if the retried request also fails (no further retries)", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fetchFail(403, "secondary rate limit", "1"))
      .mockResolvedValueOnce(fetchFail(403, "still limited", null));
    const client = makeGithubClient(ENV_ENABLED, fetchFn as unknown as typeof fetch);

    const promise = client.getDefaultBranch();
    // Attach a rejection handler immediately so the eventual rejection is
    // never observed as "unhandled" while the timer is pending.
    const assertion = expect(promise).rejects.toThrow(/failed: 403/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
