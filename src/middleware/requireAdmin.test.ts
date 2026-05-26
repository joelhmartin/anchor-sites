import express, { type RequestHandler } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "./requireAdmin.js";
import type { StudioAuth } from "../server/auth/studio-auth.js";

/** Fake Studio auth whose getSession returns a fixed result (or throws). */
function fakeAuth(user: { id: string; email: string; name?: string } | null): StudioAuth {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as StudioAuth;
}
function throwingAuth(): StudioAuth {
  return {
    api: {
      getSession: async () => {
        throw new Error("session backend down");
      },
    },
  } as unknown as StudioAuth;
}

function appWith(gate: RequestHandler) {
  const app = express();
  app.use(express.json());
  app.get("/probe", gate, (req, res) => res.json({ ok: true, user: req.studioUser }));
  return app;
}

describe("requireAdmin dual-mode (P8-T8.4 / D-034)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("1. allows a valid Studio session and sets req.studioUser", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "");
    const gate = requireAdmin({
      getAuth: () => fakeAuth({ id: "u1", email: "jmartin@anchorcorps.com", name: "JM" }),
      getMode: () => "google",
    });
    const res = await request(appWith(gate)).get("/probe");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "u1", email: "jmartin@anchorcorps.com" });
  });

  it("2. allows the X-Admin-Token when configured (service path)", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "secret-token");
    const gate = requireAdmin({ getAuth: () => null, getMode: () => "disabled" });
    const res = await request(appWith(gate)).get("/probe").set("X-Admin-Token", "secret-token");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("service-token");
  });

  it("3. 401 when token configured but missing/wrong and no session", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "secret-token");
    const gate = requireAdmin({ getAuth: () => null, getMode: () => "dev" });
    const missing = await request(appWith(gate)).get("/probe");
    expect(missing.status).toBe(401);
    const wrong = await request(appWith(gate)).get("/probe").set("X-Admin-Token", "nope");
    expect(wrong.status).toBe(401);
  });

  it("4. dev auto-grant only when in dev mode AND no token configured", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", undefined);
    const gate = requireAdmin({ getAuth: () => null, getMode: () => "dev" });
    const res = await request(appWith(gate)).get("/probe");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("dev");
  });

  it("5. 401 in disabled mode with no token and no session (fail-closed)", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", undefined);
    const gate = requireAdmin({ getAuth: () => null, getMode: () => "disabled" });
    const res = await request(appWith(gate)).get("/probe");
    expect(res.status).toBe(401);
  });

  it("6. session takes precedence over the token", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "secret-token");
    const gate = requireAdmin({
      getAuth: () => fakeAuth({ id: "u2", email: "ops@anchorcorps.com" }),
      getMode: () => "google",
    });
    const res = await request(appWith(gate)).get("/probe"); // no token header
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("u2");
  });

  it("7. a session-backend error falls through to the token path", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "secret-token");
    const gate = requireAdmin({ getAuth: () => throwingAuth(), getMode: () => "disabled" });
    const ok = await request(appWith(gate)).get("/probe").set("X-Admin-Token", "secret-token");
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe("service-token");
    const denied = await request(appWith(gate)).get("/probe");
    expect(denied.status).toBe(401);
  });
});
