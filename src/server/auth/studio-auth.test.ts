import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { pool } from "../db.js";
import {
  __resetStudioAuthForTests,
  adminAllowedEmails,
  createStudioAuth,
  getStudioAuth,
  isAllowedStudioEmail,
  makeSessionCreateGate,
  resolveStudioAuthMode,
  STUDIO_AUTH_BASE_PATH,
  STUDIO_AUTH_TABLES,
  studioAllowedDomain,
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

describe("team gate (isAllowedStudioEmail) — P8-T8.3 / D-034", () => {
  it("allows the Workspace domain (case-insensitive), rejects others", () => {
    expect(isAllowedStudioEmail("jmartin@anchorcorps.com", {})).toBe(true);
    expect(isAllowedStudioEmail("JMartin@AnchorCorps.com", {})).toBe(true);
    expect(isAllowedStudioEmail("someone@gmail.com", {})).toBe(false);
    expect(isAllowedStudioEmail("evil@notanchorcorps.com", {})).toBe(false);
  });

  it("honors the ADMIN_ALLOWED_EMAILS allowlist for non-Workspace accounts", () => {
    const env = { ADMIN_ALLOWED_EMAILS: "Contractor@gmail.com, vendor@example.org" };
    expect(isAllowedStudioEmail("contractor@gmail.com", env)).toBe(true);
    expect(isAllowedStudioEmail("vendor@example.org", env)).toBe(true);
    expect(isAllowedStudioEmail("stranger@gmail.com", env)).toBe(false);
  });

  it("honors a STUDIO_ALLOWED_DOMAIN override", () => {
    const env = { STUDIO_ALLOWED_DOMAIN: "example.com" };
    expect(studioAllowedDomain(env)).toBe("example.com");
    expect(isAllowedStudioEmail("a@example.com", env)).toBe(true);
    expect(isAllowedStudioEmail("a@anchorcorps.com", env)).toBe(false);
  });

  it("rejects empty / malformed emails", () => {
    expect(isAllowedStudioEmail(undefined, {})).toBe(false);
    expect(isAllowedStudioEmail("", {})).toBe(false);
    expect(isAllowedStudioEmail("no-at-sign", {})).toBe(false);
  });

  it("parses ADMIN_ALLOWED_EMAILS (trim, lowercase, drop blanks)", () => {
    expect(adminAllowedEmails({ ADMIN_ALLOWED_EMAILS: " A@b.com , ,C@D.com " })).toEqual(
      new Set(["a@b.com", "c@d.com"]),
    );
    expect(adminAllowedEmails({})).toEqual(new Set());
  });
});

// D804 — the allowlist must be enforced at EVERY sign-in (session creation),
// not only at first sign-in (user creation). Otherwise removing an
// ADMIN_ALLOWED_EMAILS entry / shrinking STUDIO_ALLOWED_DOMAIN never stops an
// already-created account's future Google sign-ins.
describe("session-create gate (makeSessionCreateGate) — D804", () => {
  function fakePool(rows: Array<{ email: string }>): Pool {
    return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) } as unknown as Pool;
  }

  it("allows session creation for a still-allowlisted email (returns undefined)", async () => {
    const gate = makeSessionCreateGate({ pool: fakePool([{ email: "jmartin@anchorcorps.com" }]), env: {} });
    await expect(gate({ userId: "u1" })).resolves.toBeUndefined();
  });

  it("BLOCKS session creation once the email is no longer allowed (returns false)", async () => {
    const gate = makeSessionCreateGate({ pool: fakePool([{ email: "offboarded@gmail.com" }]), env: {} });
    await expect(gate({ userId: "u1" })).resolves.toBe(false);
  });

  it("fails closed when the auth_user row is missing", async () => {
    const gate = makeSessionCreateGate({ pool: fakePool([]), env: {} });
    await expect(gate({ userId: "ghost" })).resolves.toBe(false);
  });

  it("honors env changes at sign-in time — the whole point of the directive", async () => {
    const p = fakePool([{ email: "contractor@gmail.com" }]);
    const allowed = makeSessionCreateGate({ pool: p, env: { ADMIN_ALLOWED_EMAILS: "contractor@gmail.com" } });
    await expect(allowed({ userId: "u1" })).resolves.toBeUndefined();
    const revoked = makeSessionCreateGate({ pool: p, env: { ADMIN_ALLOWED_EMAILS: "" } });
    await expect(revoked({ userId: "u1" })).resolves.toBe(false);
  });

  it("is wired into the Better-auth instance's databaseHooks", () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    expect(typeof auth.options.databaseHooks?.session?.create?.before).toBe("function");
  });
});

// D817 — session cookieCache: admin polling shouldn't pay a DB read per
// request for a verifiable cookie. Small maxAge keeps the revocation-latency
// window tight.
describe("session cookieCache — D817", () => {
  it("is enabled with a small maxAge (60s)", () => {
    const auth = createStudioAuth({ pool, env: GOOGLE_ENV });
    expect(auth.options.session?.cookieCache).toMatchObject({ enabled: true, maxAge: 60 });
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
