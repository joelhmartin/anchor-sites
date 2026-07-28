import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  enqueueImport: (input: GitImportInput) => Promise<string | null>,
  env: NodeJS.ProcessEnv = { GITHUB_WEBHOOK_SECRET: SECRET },
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
  app.use("/api", gitWebhookRouter({ pool, enqueueImport, env }));
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
});
