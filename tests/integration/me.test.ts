import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meRouter } from "../../src/server/routes/me.js";
import { __resetStudioAuthForTests } from "../../src/server/auth/studio-auth.js";

/**
 * P8-T8.5 — `/api/me` reports the authenticated admin through `requireAdmin`,
 * so the client gets one answer regardless of auth mode. No Google secrets in
 * the test env → no session check → exercises the token + dev-grant paths.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(meRouter());
  return app;
}

describe("GET /api/me (P8-T8.5)", () => {
  beforeEach(() => __resetStudioAuthForTests());
  afterEach(() => {
    __resetStudioAuthForTests();
  });

  it("200 + service-token user when the X-Admin-Token matches", async () => {
    // vi.stubEnv, not a raw `process.env` write — vitest's `unstubEnvs`
    // hygiene guarantees this resets before the next test anywhere in the
    // suite even if this test throws (root cause of the cross-file
    // requireAdmin flake — see
    // .superpowers/sdd/2026-07-30-lovable-workspace/test-pollution-debug.md).
    vi.stubEnv("ADMIN_API_TOKEN", "tok");
    const res = await request(buildApp()).get("/api/me").set("X-Admin-Token", "tok");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("service-token");
  });

  it("401 when a token is configured but missing", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "tok");
    const res = await request(buildApp()).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("200 + dev user when no token is configured (dev auto-grant)", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "");
    const res = await request(buildApp()).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("dev");
  });

  // D814 — the login page must only offer sign-in methods the deployment
  // honors, which requires an unauthenticated way to ask which mode is live.
  describe("GET /api/auth-mode (D814)", () => {
    it("reports google when all secrets are present, without auth", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
      vi.stubEnv("BETTER_AUTH_SECRET", "s3cret");
      const res = await request(buildApp()).get("/api/auth-mode");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: "google" });
    });

    it("reports dev when secrets are absent outside production", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      vi.stubEnv("NODE_ENV", "test");
      const res = await request(buildApp()).get("/api/auth-mode");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: "dev" });
    });

    it("reports disabled in production without secrets", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      vi.stubEnv("NODE_ENV", "production");
      const res = await request(buildApp()).get("/api/auth-mode");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: "disabled" });
    });
  });
});
