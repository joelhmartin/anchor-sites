import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminJobsRouter,
  type JobCountRow,
} from "../../src/server/routes/admin-jobs.js";
import { ALL_QUEUE_NAMES } from "../../src/server/jobs/index.js";

// No DB / no live pg-boss needed: every external dependency (job counts,
// runner state, last boss error) is injected, so this pins the endpoint's
// SHAPE and the D606/D114/D1009 "covers every queue" contract deterministically.

const ADMIN_TOKEN = "test-admin-token";
const auth = (r: request.Test) => r.set("X-Admin-Token", ADMIN_TOKEN);

function buildApp(opts: Parameters<typeof adminJobsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use("/api", adminJobsRouter(opts));
  return app;
}

describe("jobs-health endpoint (D606/D114/D1009/D126/D622/D1026)", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_API_TOKEN", ADMIN_TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("401s without admin auth", async () => {
    const app = buildApp({ bossEnabled: false });
    const res = await request(app).get("/api/jobs/health");
    expect(res.status).toBe(401);
  });

  it("D606: reports EVERY registered queue, not a hard-coded subset", async () => {
    const app = buildApp({
      loadJobCounts: async () => [],
      runnerState: () => ({ status: "up", error: null, since: "2026-07-31T00:00:00.000Z" }),
      lastBossError: () => null,
    });
    const res = await auth(request(app).get("/api/jobs/health"));
    expect(res.status).toBe(200);
    const names = res.body.queues.map((q: { name: string }) => q.name).sort();
    expect(names).toEqual([...ALL_QUEUE_NAMES].sort());
    // The three that the old endpoint hid must be present.
    expect(names).toContain("site.provision");
    expect(names).toContain("git.export");
    expect(names).toContain("git.import");
  });

  it("D114: surfaces per-state counts (active/queued/retry/failed) + oldest pending age", async () => {
    const rows: JobCountRow[] = [
      { name: "site.provision", state: "created", count: 3, oldest_age_seconds: 42 },
      { name: "site.provision", state: "active", count: 1, oldest_age_seconds: null },
      { name: "git.export", state: "failed", count: 2, oldest_age_seconds: null },
      { name: "git.export", state: "retry", count: 1, oldest_age_seconds: 900 },
    ];
    const app = buildApp({
      loadJobCounts: async () => rows,
      runnerState: () => ({ status: "up", error: null, since: "2026-07-31T00:00:00.000Z" }),
      lastBossError: () => null,
    });
    const res = await auth(request(app).get("/api/jobs/health"));
    const provision = res.body.queues.find((q: { name: string }) => q.name === "site.provision");
    expect(provision).toMatchObject({ queued: 3, active: 1, oldestPendingAgeSeconds: 42 });
    const gitExport = res.body.queues.find((q: { name: string }) => q.name === "git.export");
    // A failed job is visible from the product (the screenshot-checklist case).
    expect(gitExport).toMatchObject({ failed: 2, retry: 1, oldestPendingAgeSeconds: 900 });
  });

  it("D1026/D622: includes runner state + last boss error", async () => {
    const app = buildApp({
      loadJobCounts: async () => [],
      runnerState: () => ({ status: "down", error: "boot blew up", since: "2026-07-31T00:00:00.000Z" }),
      lastBossError: () => ({ message: "maintenance loop died", at: "2026-07-31T01:00:00.000Z" }),
    });
    const res = await auth(request(app).get("/api/jobs/health"));
    expect(res.body.enabled).toBe(false);
    expect(res.body.runner).toMatchObject({ status: "down", error: "boot blew up" });
    expect(res.body.lastBossError).toMatchObject({ message: "maintenance loop died" });
  });

  it("D126: served at both the canonical /jobs/health and the legacy /admin/jobs/health", async () => {
    const opts = {
      loadJobCounts: async () => [] as JobCountRow[],
      runnerState: () => ({ status: "up" as const, error: null, since: "2026-07-31T00:00:00.000Z" }),
      lastBossError: () => null,
    };
    const app = buildApp(opts);
    const canonical = await auth(request(app).get("/api/jobs/health"));
    const legacy = await auth(request(app).get("/api/admin/jobs/health"));
    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(legacy.body.queues).toHaveLength(ALL_QUEUE_NAMES.length);
  });

  it("tolerates a counts-query failure — null counts, runner state still reported", async () => {
    const app = buildApp({
      loadJobCounts: async () => {
        throw new Error("pgboss schema missing");
      },
      runnerState: () => ({ status: "up", error: null, since: "2026-07-31T00:00:00.000Z" }),
      lastBossError: () => null,
    });
    const res = await auth(request(app).get("/api/jobs/health"));
    expect(res.status).toBe(200);
    expect(res.body.queues).toHaveLength(ALL_QUEUE_NAMES.length);
    // Every queue reports zeroed counts rather than 500ing.
    expect(res.body.queues.every((q: { queued: number }) => q.queued === 0)).toBe(true);
  });
});
