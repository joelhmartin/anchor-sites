import express, { type Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { createStudioAuth } from "./studio-auth.js";
import { mountStudioAuth } from "./studio-auth-mount.js";

/**
 * P8-T8.3 — the Studio auth handler is mounted ONLY on the Studio host, with a
 * `/auth/google/callback` shim onto Better-auth's internal callback route, and
 * is a no-op in dev/disabled mode. A minimal app (no DB-backed router stack)
 * keeps these assertions about routing, not tenants. `get-session` with no
 * cookie reads nothing from the DB, so no live connection is required.
 */

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  BETTER_AUTH_SECRET: "test-session-secret-0123456789abcdef",
  STUDIO_ORIGIN: "http://studio.localhost:3000",
} satisfies NodeJS.ProcessEnv;

function buildApp(auth: ReturnType<typeof createStudioAuth> | null): {
  app: Express;
  mounted: boolean;
} {
  const app = express();
  const mounted = mountStudioAuth(app, { auth });
  app.use(express.json());
  // Sentinel: anything the studio handler didn't terminate lands here.
  app.use((_req, res) => res.status(404).json({ fellThrough: true }));
  return { app, mounted };
}

describe("mountStudioAuth (P8-T8.3)", () => {
  afterEach(async () => {
    // best-effort: nothing persisted, but keep pool usage tidy across files.
  });

  it("handles /api/auth/get-session on the Studio host (not fall-through)", async () => {
    const { app, mounted } = buildApp(createStudioAuth({ pool, env: GOOGLE_ENV }));
    expect(mounted).toBe(true);
    const res = await request(app)
      .get("/api/auth/get-session")
      .set("Host", "studio.localhost");
    expect(res.status).toBe(200);
    expect(res.body?.fellThrough).toBeUndefined(); // Better-auth answered, not the sentinel.
  });

  it("does NOT handle /api/auth on a tenant host (falls through for tenant auth)", async () => {
    const { app } = buildApp(createStudioAuth({ pool, env: GOOGLE_ENV }));
    const res = await request(app)
      .get("/api/auth/get-session")
      .set("Host", "demo.sites.anchorcorps.com");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ fellThrough: true });
  });

  it("routes /auth/google/callback to Better-auth on the Studio host (shim)", async () => {
    const { app } = buildApp(createStudioAuth({ pool, env: GOOGLE_ENV }));
    const res = await request(app)
      .get("/auth/google/callback")
      .set("Host", "studio.localhost");
    // No valid OAuth state → Better-auth rejects (redirect or 4xx), but it is
    // NOT the fall-through sentinel — proving the shim reached the handler.
    expect(res.body?.fellThrough).toBeUndefined();
    expect(res.status).not.toBe(404);
  });

  it("is a no-op in dev/disabled mode (auth=null) — nothing mounted", async () => {
    const { app, mounted } = buildApp(null);
    expect(mounted).toBe(false);
    const res = await request(app)
      .get("/api/auth/get-session")
      .set("Host", "studio.localhost");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ fellThrough: true });
  });
});
