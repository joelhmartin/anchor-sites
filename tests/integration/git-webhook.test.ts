import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Fix round 1 (Important 3): spy on pg-boss's `getBoss().send` while keeping
// every other export of jobs/index.js real, so the singletonKey tests below
// can exercise gitWebhookRouter's REAL default `enqueueImport` (the lazy
// `getBoss().send(GIT_IMPORT, input, {singletonKey})` idiom) instead of the
// injected spy every other test in this file uses. Every OTHER test in this
// file always injects its own `enqueueImport`, so it never reaches the
// dynamic `import("../jobs/index.js")` this mock targets — safe to mock
// module-wide.
const bossSendSpy = vi.fn(async (..._args: unknown[]) => "job-id-1");
vi.mock("../../src/server/jobs/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/jobs/index.js")>();
  return {
    ...actual,
    getBoss: () => ({ send: bossSendSpy }) as unknown as ReturnType<typeof actual.getBoss>,
  };
});

import { setupAgentDb } from "../helpers/agent-db.js";
import {
  gitWebhookRouter,
  verifyGithubSignature,
  type RawBodyRequest,
  type GitImportInput,
} from "../../src/server/routes/git-webhook.js";
import { setGitEnabled } from "../../src/server/git/state-repo.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const SECRET = "test-webhook-secret";

// Round 1 review fix: the webhook now cheap-gates on `resolveGitMode(env)`
// (git.export's established convention), which requires BOTH a content
// token and a repo to resolve to "api" — independent of
// GITHUB_WEBHOOK_SECRET. Every test that expects an actual enqueue needs
// this env alongside the secret; the one test that omits it exercises the
// new disabled-mode short-circuit.
const ENABLED_ENV: NodeJS.ProcessEnv = {
  GITHUB_WEBHOOK_SECRET: SECRET,
  GITHUB_CONTENT_TOKEN: "test-content-token",
  GITHUB_CONTENT_REPO: "acme/content",
};

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Builds a minimal, otherwise-valid push payload for one site slug. */
function pushPayload(opts: {
  slug: string;
  defaultBranch?: string;
  ref?: string;
  after?: string;
  commits?: Array<{
    message: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
}) {
  const defaultBranch = opts.defaultBranch ?? "main";
  return {
    ref: opts.ref ?? `refs/heads/${defaultBranch}`,
    after: opts.after ?? "abc123headSha",
    repository: { default_branch: defaultBranch },
    commits: opts.commits ?? [
      {
        message: "edit home page",
        added: [],
        modified: [`sites/${opts.slug}/pages/home.json`],
        removed: [],
      },
    ],
  };
}

function buildApp(
  pool: import("pg").Pool,
  // Fix round 1: optional now — omitting it exercises gitWebhookRouter's
  // REAL default enqueueImport (routed through the mocked `getBoss().send`
  // above), which every OTHER test in this file bypasses by injecting its
  // own spy.
  enqueueImport?: (input: GitImportInput) => Promise<string | null>,
  env: NodeJS.ProcessEnv = ENABLED_ENV,
  // D602/D116: injected so the null-return disambiguation (dedupe vs. genuine
  // failure) is deterministic without a live pgboss schema.
  hasLiveImportJob?: (siteId: string, headSha: string) => Promise<boolean>,
) {
  const app = express();
  // Mirrors the app.ts verify hook (Global Constraints, raw-body rule).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
  app.use(
    "/api",
    gitWebhookRouter({
      pool,
      ...(enqueueImport ? { enqueueImport } : {}),
      ...(hasLiveImportJob ? { hasLiveImportJob } : {}),
      env,
    }),
  );
  return app;
}

describe("verifyGithubSignature (pure function, no DB)", () => {
  it("accepts a correctly signed body", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyGithubSignature(SECRET, body, sig)).toBe(true);
  });

  it("rejects an incorrect signature", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const wrongSig = "sha256=" + "0".repeat(64);
    expect(verifyGithubSignature(SECRET, body, wrongSig)).toBe(false);
  });

  it("rejects an undefined header", () => {
    const body = Buffer.from("{}");
    expect(verifyGithubSignature(SECRET, body, undefined)).toBe(false);
  });

  it("rejects a header of the wrong length (timingSafeEqual guard)", () => {
    const body = Buffer.from("{}");
    expect(verifyGithubSignature(SECRET, body, "sha256=abc")).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", () => {
    const body = Buffer.from("{}");
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyGithubSignature(SECRET, body, hex)).toBe(false);
  });
});

d("POST /api/git/webhook (integration, GitHub sync Task 5)", () => {
  const db = setupAgentDb();
  let enqueueSpy: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeAll(async () => {
    await db.runMigrations();
    enqueueSpy = vi.fn(async () => "job-id-1");
    app = buildApp(db.getPool(), enqueueSpy);
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  afterEach(() => {
    bossSendSpy.mockClear();
  });

  it("503s when GITHUB_WEBHOOK_SECRET is unset — no signature check, no enqueue", async () => {
    const noSecretApp = buildApp(db.getPool(), enqueueSpy, {});
    const body = pushPayload({ slug: "whatever" });
    const res = await request(noSecretApp)
      .post("/api/git/webhook")
      .set("X-GitHub-Event", "push")
      .send(body);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "webhook not configured" });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("503s when GITHUB_WEBHOOK_SECRET is still the placeholder sentinel \"disabled\" — even for a correctly-signed push against that literal value, no enqueue", async () => {
    // Security fix round 2 (Important 1): the placeholder value Task 8
    // seeds into Secret Manager ahead of a real secret is a *publicly
    // documented* literal ("disabled") — a deployment that hasn't rotated
    // it yet must never accept a signature computed against that literal,
    // or anyone reading this file could forge a push. Sign the body with
    // "disabled" itself to prove this isn't just falling through to the
    // generic bad-signature 401 path.
    const placeholderSecretApp = buildApp(db.getPool(), enqueueSpy, {
      GITHUB_WEBHOOK_SECRET: "disabled",
      GITHUB_CONTENT_TOKEN: "test-content-token",
      GITHUB_CONTENT_REPO: "acme/content",
    });
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-placeholder-secret");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(pushPayload({ slug: site.slug }));
    const res = await request(placeholderSecretApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw, "disabled"))
      .send(raw);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "webhook not configured" });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("401s on a bad signature and never enqueues", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-badsig");
    await setGitEnabled(db.getPool(), site.id, true);
    const body = pushPayload({ slug: site.slug });
    const res = await request(app)
      .post("/api/git/webhook")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", "sha256=" + "0".repeat(64))
      .send(body);
    expect(res.status).toBe(401);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("204s on a non-push event", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-nonpush");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(pushPayload({ slug: site.slug }));
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "ping")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(204);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("204s when the push is not against the default branch", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-branch");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(
      pushPayload({ slug: site.slug, ref: "refs/heads/feature-x", defaultBranch: "main" }),
    );
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(204);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("204s when every commit carries the Anchor-Sync: export trailer (loop prevention)", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-trailer");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(
      pushPayload({
        slug: site.slug,
        commits: [
          {
            message: `export(${site.slug}): publish\n\nAnchor-Sync: export`,
            added: [],
            modified: [`sites/${site.slug}/pages/home.json`],
            removed: [],
          },
        ],
      }),
    );
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(204);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("204s + zero enqueue when git sync is globally disabled (no content token/repo), even for an otherwise-valid signed push", async () => {
    // Round 1 review fix: cheap-gate on resolveGitMode BEFORE the per-site
    // DB loop. Distinct app instance: same webhook secret (so the signature
    // still verifies), but GITHUB_CONTENT_TOKEN/REPO are absent — the exact
    // env shape resolveGitMode(env) treats as "disabled".
    const disabledModeEnqueueSpy = vi.fn(async () => "job-id-should-not-be-called");
    const disabledModeApp = buildApp(db.getPool(), disabledModeEnqueueSpy, {
      GITHUB_WEBHOOK_SECRET: SECRET,
    });
    const site = await db.seedSite("gitwh-mode-disabled");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(pushPayload({ slug: site.slug }));
    const res = await request(disabledModeApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(204);
    expect(disabledModeEnqueueSpy).not.toHaveBeenCalled();
  });

  it("does not enqueue for a site whose git sync is disabled", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-disabled");
    // No setGitEnabled call — row absent entirely (disabled by default).
    const raw = JSON.stringify(pushPayload({ slug: site.slug }));
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(204);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("202s + enqueues the correct siteId/headSha/paths for a valid push with one modified page", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-valid");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(
      pushPayload({ slug: site.slug, after: "deadbeef01" }),
    );
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: [site.slug] });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith({
      siteId: site.id,
      headSha: "deadbeef01",
      paths: [`sites/${site.slug}/pages/home.json`],
    });
  });

  it("D602/D116: 503s (GitHub redelivers) when the import enqueue returns null and no live job exists — never acks lost work with 202", async () => {
    const site = await db.seedSite("gitwh-enqueue-null");
    await setGitEnabled(db.getPool(), site.id, true);
    // Enqueue returns null (queue outage), and there's NO live job for this
    // sha → genuine failure, not a dedupe.
    const nullApp = buildApp(
      db.getPool(),
      async () => null,
      ENABLED_ENV,
      async () => false,
    );
    const raw = JSON.stringify(pushPayload({ slug: site.slug, after: "lostsha01" }));
    const res = await request(nullApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(503);
    expect(res.body.failed).toEqual([site.slug]);
  });

  it("D602/D116: 202s (dedupe, not a failure) when the enqueue returns null but a live import job already exists for this sha", async () => {
    const site = await db.seedSite("gitwh-enqueue-dedupe");
    await setGitEnabled(db.getPool(), site.id, true);
    const dedupeApp = buildApp(
      db.getPool(),
      async () => null, // stately dedupe: same push already queued/active
      ENABLED_ENV,
      async () => true, // a live job for this key exists → not a failure
    );
    const raw = JSON.stringify(pushPayload({ slug: site.slug, after: "dupesha01" }));
    const res = await request(dedupeApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: [site.slug] });
  });

  it("prefixes removed paths with REMOVED: and still fans out per site", async () => {
    enqueueSpy.mockClear();
    const site = await db.seedSite("gitwh-removed");
    await setGitEnabled(db.getPool(), site.id, true);
    const raw = JSON.stringify(
      pushPayload({
        slug: site.slug,
        after: "removedsha",
        commits: [
          {
            message: "drop a page",
            added: [],
            modified: [],
            removed: [`sites/${site.slug}/pages/old.json`],
          },
        ],
      }),
    );
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: [site.slug] });
    expect(enqueueSpy).toHaveBeenCalledWith({
      siteId: site.id,
      headSha: "removedsha",
      paths: [`REMOVED:sites/${site.slug}/pages/old.json`],
    });
  });

  it("groups distinct changed paths by slug across multiple sites in one push", async () => {
    enqueueSpy.mockClear();
    const siteA = await db.seedSite("gitwh-multi-a");
    const siteB = await db.seedSite("gitwh-multi-b");
    await setGitEnabled(db.getPool(), siteA.id, true);
    await setGitEnabled(db.getPool(), siteB.id, true);
    const raw = JSON.stringify({
      ref: "refs/heads/main",
      after: "multisha",
      repository: { default_branch: "main" },
      commits: [
        {
          message: "edit both sites",
          added: [`sites/${siteA.slug}/pages/new.json`],
          modified: [`sites/${siteB.slug}/pages/home.json`],
          removed: [],
        },
      ],
    });
    const res = await request(app)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(202);
    expect(res.body.queued.sort()).toEqual([siteA.slug, siteB.slug].sort());
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
  });

  // --- Fix round 1 (Important 3): default enqueueImport's singletonKey ----
  //
  // These two tests skip the injected `enqueueSpy` entirely (no second arg
  // to `buildApp`) so gitWebhookRouter's REAL default enqueueImport runs —
  // the one that calls `getBoss().send(GIT_IMPORT, input, {singletonKey})`,
  // mocked at the top of this file to capture calls in `bossSendSpy` instead
  // of touching a real pg-boss instance.

  it("keys the default enqueue's pg-boss send() on `${siteId}:${headSha}` — two DIFFERENT pushes to the same site both get sent, not collapsed under the stately policy", async () => {
    const site = await db.seedSite("gitwh-singletonkey");
    await setGitEnabled(db.getPool(), site.id, true);
    const noInjectApp = buildApp(db.getPool());

    const raw1 = JSON.stringify(pushPayload({ slug: site.slug, after: "sha-one" }));
    await request(noInjectApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw1))
      .send(raw1);

    const raw2 = JSON.stringify(pushPayload({ slug: site.slug, after: "sha-two" }));
    await request(noInjectApp)
      .post("/api/git/webhook")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", "push")
      .set("X-Hub-Signature-256", sign(raw2))
      .send(raw2);

    expect(bossSendSpy).toHaveBeenCalledTimes(2);
    // D603: the send() options now also carry the retry ladder — assert the
    // singletonKey via objectContaining rather than an exact-equal.
    expect(bossSendSpy).toHaveBeenNthCalledWith(
      1,
      "git.import",
      expect.objectContaining({ siteId: site.id, headSha: "sha-one" }),
      expect.objectContaining({ singletonKey: `${site.id}:sha-one` }),
    );
    expect(bossSendSpy).toHaveBeenNthCalledWith(
      2,
      "git.import",
      expect.objectContaining({ siteId: site.id, headSha: "sha-two" }),
      expect.objectContaining({ singletonKey: `${site.id}:sha-two` }),
    );
  });

  it("uses the SAME singletonKey for a redelivered push (same siteId+headSha twice) — this code always calls send(); the actual dedupe is enforced DB-side by pg-boss's stately policy, not by this route", async () => {
    const site = await db.seedSite("gitwh-samekey");
    await setGitEnabled(db.getPool(), site.id, true);
    const noInjectApp = buildApp(db.getPool());
    const raw = JSON.stringify(pushPayload({ slug: site.slug, after: "same-sha" }));

    for (let i = 0; i < 2; i++) {
      // eslint-disable-next-line no-await-in-loop
      await request(noInjectApp)
        .post("/api/git/webhook")
        .set("Content-Type", "application/json")
        .set("X-GitHub-Event", "push")
        .set("X-Hub-Signature-256", sign(raw))
        .send(raw);
    }

    expect(bossSendSpy).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = bossSendSpy.mock.calls;
    expect(firstCall[2]).toMatchObject({ singletonKey: `${site.id}:same-sha` });
    expect(secondCall[2]).toMatchObject({ singletonKey: `${site.id}:same-sha` });
  });
});
