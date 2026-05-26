import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    delete process.env.ADMIN_API_TOKEN;
    __resetStudioAuthForTests();
  });

  it("200 + service-token user when the X-Admin-Token matches", async () => {
    process.env.ADMIN_API_TOKEN = "tok";
    const res = await request(buildApp()).get("/api/me").set("X-Admin-Token", "tok");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("service-token");
  });

  it("401 when a token is configured but missing", async () => {
    process.env.ADMIN_API_TOKEN = "tok";
    const res = await request(buildApp()).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("200 + dev user when no token is configured (dev auto-grant)", async () => {
    delete process.env.ADMIN_API_TOKEN;
    const res = await request(buildApp()).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("dev");
  });
});
