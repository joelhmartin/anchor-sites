import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { setupAgentDb } from "../helpers/agent-db.js";
import { adminGitRouter, type AdminGitOptions } from "../../src/server/routes/admin-git.js";
import { setGitEnabled } from "../../src/server/git/state-repo.js";
import type { GitExportInput } from "../../src/server/jobs/git-export.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DB_URL ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);
const UNKNOWN_SITE_ID = "00000000-0000-0000-0000-000000000000";

function buildApp(
  pool: Pool,
  enqueueExport: (input: GitExportInput) => Promise<string | null>,
  env: NodeJS.ProcessEnv = {},
  hasLiveExportJob?: (siteId: string) => Promise<boolean>,
  // D603/D416: import re-drive deps, injectable so tests don't need a live
  // pgboss schema.
  extra?: Pick<AdminGitOptions, "loadLastImportPayload" | "enqueueImport">,
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    adminGitRouter({
      pool,
      enqueueExport,
      env,
      hasLiveExportJob,
      rateLimit: { max: 200, windowMs: 60_000 },
      ...extra,
    }),
  );
  return app;
}

d("admin git endpoints (integration, GitHub sync Task 7)", () => {
  const db = setupAgentDb();
  let enqueueSpy: ReturnType<typeof vi.fn>;
  // Server-wide git mode "disabled" (no GITHUB_CONTENT_TOKEN/REPO) — the
  // default state every site starts in.
  let app: express.Express;
  // Server-wide git mode "api" — token + repo configured.
  let appConfigured: express.Express;

  // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs` hygiene
  // then guarantees this resets before the next test anywhere in the suite,
  // regardless of how long any file's own `afterAll` takes (root cause of
  // the cross-file requireAdmin flake — see
  // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });

  beforeAll(async () => {
    await db.runMigrations();
    enqueueSpy = vi.fn(async () => "job-id-1");
    app = buildApp(db.getPool(), enqueueSpy, {});
    appConfigured = buildApp(db.getPool(), enqueueSpy, {
      GITHUB_CONTENT_TOKEN: "test-token",
      GITHUB_CONTENT_REPO: "anchorcorps/content",
    });
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("GET /sites/:siteId/git", () => {
    it("401s without admin auth", async () => {
      const site = await db.seedSite("git-get-noauth");
      const res = await request(app).get(`/api/sites/${site.id}/git`);
      expect(res.status).toBe(401);
    });

    it("404s for an unknown site", async () => {
      const res = await auth(request(app).get(`/api/sites/${UNKNOWN_SITE_ID}/git`));
      expect(res.status).toBe(404);
    });

    it("reports configured:false, repo:null, state:null when git mode is disabled", async () => {
      const site = await db.seedSite("git-get-unconfigured");
      const res = await auth(request(app).get(`/api/sites/${site.id}/git`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false, repo: null, state: null });
    });

    it("reports configured:true + repo + state once the server is configured and the site enabled", async () => {
      const site = await db.seedSite("git-get-configured");
      await setGitEnabled(db.getPool(), site.id, true);
      const res = await auth(request(appConfigured).get(`/api/sites/${site.id}/git`));
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.repo).toBe("anchorcorps/content");
      expect(res.body.state.enabled).toBe(true);
    });
  });

  describe("POST /sites/:siteId/git/enable", () => {
    it("400s on invalid payload", async () => {
      const site = await db.seedSite("git-enable-invalid");
      const res = await auth(
        request(app).post(`/api/sites/${site.id}/git/enable`).send({ enabled: "yes" }),
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid payload");
    });

    it("404s for an unknown site", async () => {
      const res = await auth(
        request(app).post(`/api/sites/${UNKNOWN_SITE_ID}/git/enable`).send({ enabled: true }),
      );
      expect(res.status).toBe(404);
    });

    it("upserts an enabled state row and enqueues an initial export", async () => {
      enqueueSpy.mockClear();
      const site = await db.seedSite("git-enable");
      const res = await auth(
        request(app).post(`/api/sites/${site.id}/git/enable`).send({ enabled: true }),
      );
      expect(res.status).toBe(200);
      expect(res.body.state.enabled).toBe(true);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(enqueueSpy).toHaveBeenCalledWith({ siteId: site.id, trigger: "initial" });
    });

    it("disabling upserts the row but does NOT enqueue", async () => {
      const site = await db.seedSite("git-disable");
      await auth(request(app).post(`/api/sites/${site.id}/git/enable`).send({ enabled: true }));
      enqueueSpy.mockClear();
      const res = await auth(
        request(app).post(`/api/sites/${site.id}/git/enable`).send({ enabled: false }),
      );
      expect(res.status).toBe(200);
      expect(res.body.state.enabled).toBe(false);
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it("503s honestly when the initial-export enqueue fails, instead of a fake 200", async () => {
      // Explicit "no live job" arrangement (fix round 1) — GIT_EXPORT's
      // `stately` policy means a bare `null` is ambiguous; this test pins
      // down the genuinely-down case regardless of whether the pgboss
      // schema happens to exist in the test DB.
      const failApp = buildApp(db.getPool(), vi.fn(async () => null), {}, async () => false);
      const site = await db.seedSite("git-enable-fail");
      const res = await auth(
        request(failApp).post(`/api/sites/${site.id}/git/enable`).send({ enabled: true }),
      );
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "job queue unavailable" });
    });

    // Fix round 1 (Important): a `null` enqueue result under GIT_EXPORT's
    // `stately` policy can mean "deduped" (a job for this site is already
    // queued/active) rather than "queue is down" — this must NOT 503.
    it("200s with queued:true, deduped:true when the initial-export enqueue is null but a live job already exists", async () => {
      const dedupedApp = buildApp(db.getPool(), vi.fn(async () => null), {}, async () => true);
      const site = await db.seedSite("git-enable-deduped");
      const res = await auth(
        request(dedupedApp).post(`/api/sites/${site.id}/git/enable`).send({ enabled: true }),
      );
      expect(res.status).toBe(200);
      expect(res.body.state.enabled).toBe(true);
      expect(res.body.queued).toBe(true);
      expect(res.body.deduped).toBe(true);
    });
  });

  describe("POST /sites/:siteId/git/export", () => {
    it("404s for an unknown site", async () => {
      const res = await auth(request(app).post(`/api/sites/${UNKNOWN_SITE_ID}/git/export`).send({}));
      expect(res.status).toBe(404);
    });

    it("409s when git sync isn't enabled for this site", async () => {
      const site = await db.seedSite("git-export-disabled");
      const res = await auth(request(app).post(`/api/sites/${site.id}/git/export`).send({}));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "git not enabled" });
    });

    it("202s + enqueues a manual export once enabled", async () => {
      const site = await db.seedSite("git-export-enabled");
      await setGitEnabled(db.getPool(), site.id, true);
      enqueueSpy.mockClear();
      const res = await auth(request(app).post(`/api/sites/${site.id}/git/export`).send({}));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ queued: true });
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(enqueueSpy).toHaveBeenCalledWith({ siteId: site.id, trigger: "manual" });
    });

    it("503s honestly when the manual-export enqueue fails", async () => {
      // Explicit "no live job" arrangement — see the enable-handler test
      // above for why this can no longer rely on an absent pgboss schema.
      const failApp = buildApp(db.getPool(), vi.fn(async () => null), {}, async () => false);
      const site = await db.seedSite("git-export-fail");
      await setGitEnabled(db.getPool(), site.id, true);
      const res = await auth(request(failApp).post(`/api/sites/${site.id}/git/export`).send({}));
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "job queue unavailable" });
    });

    // Fix round 1 (Important): same disambiguation on the manual-export path.
    it("202s with queued:true, deduped:true when the manual-export enqueue is null but a live job already exists", async () => {
      const dedupedApp = buildApp(db.getPool(), vi.fn(async () => null), {}, async () => true);
      const site = await db.seedSite("git-export-deduped");
      await setGitEnabled(db.getPool(), site.id, true);
      const res = await auth(request(dedupedApp).post(`/api/sites/${site.id}/git/export`).send({}));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ queued: true, deduped: true });
    });

    it("cross-site 404: a site's git state never leaks into another site's export check", async () => {
      const siteA = await db.seedSite("git-cross-a");
      const siteB = await db.seedSite("git-cross-b");
      await setGitEnabled(db.getPool(), siteA.id, true);
      // siteB never enabled — its own export must still 409, not ride on
      // siteA's enabled state.
      const res = await auth(request(app).post(`/api/sites/${siteB.id}/git/export`).send({}));
      expect(res.status).toBe(409);
    });
  });

  // D603/D416: manual import re-drive.
  describe("POST /sites/:siteId/git/import", () => {
    it("409s when git sync is not enabled for the site", async () => {
      const site = await db.seedSite("git-import-disabled");
      const res = await auth(request(app).post(`/api/sites/${site.id}/git/import`).send({}));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "git not enabled" });
    });

    it("404s when the site has never had an import job to re-drive", async () => {
      const site = await db.seedSite("git-import-none");
      await setGitEnabled(db.getPool(), site.id, true);
      const reApp = buildApp(db.getPool(), enqueueSpy, {}, undefined, {
        loadLastImportPayload: async () => null,
      });
      const res = await auth(request(reApp).post(`/api/sites/${site.id}/git/import`).send({}));
      expect(res.status).toBe(404);
    });

    it("202s and re-enqueues the most recent import payload for the site", async () => {
      const site = await db.seedSite("git-import-redrive");
      await setGitEnabled(db.getPool(), site.id, true);
      const payload = { siteId: site.id, headSha: "failedsha1", paths: ["sites/x/pages/home.json"] };
      const enqueueImport = vi.fn(async () => "reimport-job-1");
      const reApp = buildApp(db.getPool(), enqueueSpy, {}, undefined, {
        loadLastImportPayload: async () => payload,
        enqueueImport,
      });
      const res = await auth(request(reApp).post(`/api/sites/${site.id}/git/import`).send({}));
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ queued: true, headSha: "failedsha1" });
      expect(enqueueImport).toHaveBeenCalledWith(payload);
    });
  });
});
