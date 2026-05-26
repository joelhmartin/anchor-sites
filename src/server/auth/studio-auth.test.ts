import { afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../db.js";
import {
  __resetStudioAuthForTests,
  createStudioAuth,
  getStudioAuth,
  resolveStudioAuthMode,
  STUDIO_AUTH_BASE_PATH,
  STUDIO_AUTH_TABLES,
  studioCallbackUrl,
  studioOrigin,
} from "./studio-auth.js";

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  BETTER_AUTH_SECRET: "test-session-secret-0123456789abcdef",
} satisfies NodeJS.ProcessEnv;

describe("resolveStudioAuthMode", () => {
  it("is 'google' only when Google creds AND a session secret are all present", () => {
    expect(resolveStudioAuthMode(GOOGLE_ENV)).toBe("google");
  });

  it("is 'dev' when secrets are absent and not in production", () => {
    expect(resolveStudioAuthMode({ NODE_ENV: "development" })).toBe("dev");
    expect(resolveStudioAuthMode({ NODE_ENV: "test" })).toBe("dev");
  });

  it("is 'disabled' when secrets are absent in production (no lock-out — token still works)", () => {
    expect(resolveStudioAuthMode({ NODE_ENV: "production" })).toBe("disabled");
  });

  it("falls back to dev/disabled when the session secret is missing (partial config)", () => {
    const partial = { GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" };
    expect(resolveStudioAuthMode({ ...partial, NODE_ENV: "development" })).toBe("dev");
    expect(resolveStudioAuthMode({ ...partial, NODE_ENV: "production" })).toBe("disabled");
  });
});

describe("studioOrigin / studioCallbackUrl", () => {
  it("honors STUDIO_ORIGIN and strips a trailing slash", () => {
    expect(studioOrigin({ STUDIO_ORIGIN: "https://studio.example.com/" })).toBe(
      "https://studio.example.com",
    );
  });

  it("defaults to https on the studio host in production", () => {
    expect(studioOrigin({ NODE_ENV: "production" })).toBe("https://studio.anchorcorps.com");
  });

  it("defaults to the local studio host outside production", () => {
    expect(studioOrigin({ NODE_ENV: "development" })).toBe("http://studio.localhost:3000");
  });

  it("builds the callback at the operator-documented /auth/google/callback path", () => {
    expect(studioCallbackUrl({ NODE_ENV: "production" })).toBe(
      "https://studio.anchorcorps.com/auth/google/callback",
    );
    // NOT Better-auth's default /api/auth/callback/google — matches the D-034 prereq.
    expect(studioCallbackUrl({ NODE_ENV: "production" })).not.toContain("/api/auth/callback");
  });
});

describe("createStudioAuth", () => {
  it("constructs a Better-auth instance (handler + api) without DB I/O", () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    expect(typeof auth.handler).toBe("function");
    expect(typeof auth.api).toBe("object");
  });

  it("uses the /api/auth base path and the auth_* table names", () => {
    expect(STUDIO_AUTH_BASE_PATH).toBe("/api/auth");
    expect(STUDIO_AUTH_TABLES).toEqual({
      user: "auth_user",
      session: "auth_session",
      account: "auth_account",
      verification: "auth_verification",
    });
  });
});

describe("getStudioAuth (cached singleton)", () => {
  afterEach(() => {
    __resetStudioAuthForTests();
  });

  it("returns null in dev mode (no instance built without secrets)", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    __resetStudioAuthForTests();
    expect(getStudioAuth()).toBeNull();
  });

  it("returns a configured instance when the env resolves to google mode", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", GOOGLE_ENV.GOOGLE_CLIENT_ID);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", GOOGLE_ENV.GOOGLE_CLIENT_SECRET);
    vi.stubEnv("BETTER_AUTH_SECRET", GOOGLE_ENV.BETTER_AUTH_SECRET);
    __resetStudioAuthForTests();
    const auth = getStudioAuth();
    expect(auth).not.toBeNull();
    expect(typeof auth!.handler).toBe("function");
  });
});
