/**
 * Studio control-hub authentication (Phase 8, Track A — D-034 / D-046).
 *
 * The Studio admin hub (`studio.anchorcorps.com`, D-032) authenticates the
 * INTERNAL AnchorCorps team via Google OAuth, implemented with Better-auth
 * (D-020). This module owns the Better-auth instance + the env-driven mode
 * switch; mounting the handler on the Studio host and the `requireAdmin` flip
 * land in tasks 8.3 / 8.4. Per-site TENANT auth (Track B) is a SEPARATE
 * surface (`tenant-auth.ts`, 8.8) — these never share rows.
 *
 * Mode switch mirrors `src/server/ai/config.ts` (D-038) + `email/send.ts`
 * (D-012) so dev + tests never perform a real Google round-trip:
 *   - Google + session secrets all present  → "google"   (real OAuth)
 *   - secrets absent, NODE_ENV !== production → "dev"      (auto-granted session)
 *   - secrets absent, production              → "disabled" (prod stays on the
 *                                                X-Admin-Token until the
 *                                                operator provisions secrets)
 *
 * Because `requireAdmin` (8.4) accepts EITHER a Studio session OR the interim
 * X-Admin-Token, prod can run in "disabled" mode with zero lock-out risk while
 * the operator's Google Client ID + BETTER_AUTH_SECRET are still pending
 * (operator prereq; see docs/studio-auth.md / PHASE-08-auth.md).
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";
import { studioHost } from "../../config/admin-host.js";

/** Better-auth route prefix. Studio + tenant handlers share this path but are
 *  disambiguated by Host (Studio short-circuit vs tenant resolution), so there
 *  is no collision. */
export const STUDIO_AUTH_BASE_PATH = "/api/auth";

/** Studio auth table names — mapped to the `auth_*` convention reserved in
 *  docs/data-model.md (the migration in 8.2 creates exactly these). Tenant
 *  auth (8.7) uses `tenant_auth_*` + a `site_id` column instead. */
export const STUDIO_AUTH_TABLES = {
  user: "auth_user",
  session: "auth_session",
  account: "auth_account",
  verification: "auth_verification",
} as const;

export type StudioAuthMode = "google" | "dev" | "disabled";

/**
 * The Studio origin (scheme + host, no trailing slash) used as Better-auth's
 * `baseURL` and the base of the OAuth callback. Override with `STUDIO_ORIGIN`;
 * otherwise derived from `studioHost()` — https in production, http on the
 * local `studio.localhost:3000` dev host.
 */
export function studioOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STUDIO_ORIGIN?.trim();
  if (override) return override.replace(/\/+$/, "");
  const host = studioHost();
  if (env.NODE_ENV === "production") return `https://${host}`;
  return "http://studio.localhost:3000";
}

/**
 * The Google OAuth callback URL. Deliberately `/auth/google/callback` (NOT
 * Better-auth's default `/api/auth/callback/google`) so it matches the
 * redirect URI the operator already documented for the Google Console prereq
 * (D-034) — the operator does not have to re-register it. Task 8.3 mounts a
 * forwarding shim from this path to Better-auth's internal callback route.
 */
export function studioCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${studioOrigin(env)}/auth/google/callback`;
}

/** Resolve the auth mode from env (see module doc). */
export function resolveStudioAuthMode(env: NodeJS.ProcessEnv = process.env): StudioAuthMode {
  const hasGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const hasSecret = Boolean(env.BETTER_AUTH_SECRET);
  if (hasGoogle && hasSecret) return "google";
  if (env.NODE_ENV !== "production") return "dev";
  return "disabled";
}

/**
 * The Google Workspace domain whose members may sign into Studio. Defaults to
 * `anchorcorps.com` (D-034); override with `STUDIO_ALLOWED_DOMAIN`.
 */
export function studioAllowedDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.STUDIO_ALLOWED_DOMAIN?.trim() || "anchorcorps.com").toLowerCase();
}

/** The optional non-Workspace allowlist (`ADMIN_ALLOWED_EMAILS`, comma-sep). */
export function adminAllowedEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.ADMIN_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Team gate (D-034): a Google sign-in is allowed only when the account is in
 * the Workspace domain (email domain === `studioAllowedDomain`) OR explicitly
 * allow-listed via `ADMIN_ALLOWED_EMAILS`. Pure + greppable so it is unit-
 * tested directly; the Better-auth `user.create.before` hook is thin glue that
 * calls it and rejects account creation for anyone else (so a non-team person
 * can never establish a session).
 */
export function isAllowedStudioEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at === -1) return false;
  const domain = normalized.slice(at + 1);
  if (domain === studioAllowedDomain(env)) return true;
  return adminAllowedEmails(env).has(normalized);
}

/**
 * D804 — enforce the team gate at SESSION creation (every sign-in), not only
 * at user creation (first sign-in). This is what makes allowlist removal an
 * actual revocation: editing `ADMIN_ALLOWED_EMAILS` / `STUDIO_ALLOWED_DOMAIN`
 * now stops that account's future Google sign-ins, even though its
 * `auth_user` row still exists.
 *
 * The hook RETURNS FALSE to block (never throws): Better-auth's OAuth
 * callback wraps only user-creation in try/catch — a throw from
 * `createSession` would escape `handleOAuthUserInfo` and surface as a raw
 * JSON error mid-redirect. Returning false makes `createSession` yield null,
 * which the callback turns into a clean `?error=unable_to_create_session`
 * redirect — the code LoginPage explains (D800).
 *
 * Fails closed: a missing `auth_user` row (or an unreadable email) blocks the
 * session. Exported as a factory so the gate is unit-testable with a fake
 * pool.
 */
export function makeSessionCreateGate(opts: { pool: Pool; env: NodeJS.ProcessEnv }) {
  return async (session: { userId: string }): Promise<false | undefined> => {
    const res = await opts.pool.query<{ email: string }>(
      `SELECT email FROM ${STUDIO_AUTH_TABLES.user} WHERE id = $1`,
      [session.userId],
    );
    const email = res.rows[0]?.email;
    if (!isAllowedStudioEmail(email, opts.env)) return false;
    // undefined → proceed unchanged.
    return undefined;
  };
}

/**
 * Build a Studio Better-auth instance. Pure factory (no module state) so tests
 * can construct with injected env + pool. Only valid when the env resolves to
 * "google" mode — callers in "dev"/"disabled" must not build an instance (no
 * secrets to configure). Construction does no DB I/O; the pool is queried
 * lazily on the first request.
 *
 * The return type is intentionally inferred (not annotated as
 * `ReturnType<typeof betterAuth>`): `betterAuth` narrows its `Auth<…>` generic
 * to the concrete options, and the widened `Auth<BetterAuthOptions>` is not
 * assignable back (contravariant adapter type).
 */
export function createStudioAuth(opts: {
  pool?: Pool;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const env = opts.env ?? process.env;
  const pool = opts.pool ?? defaultPool;
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: studioOrigin(env),
    basePath: STUDIO_AUTH_BASE_PATH,
    trustedOrigins: [studioOrigin(env)],
    // Studio is Google-only — internal team, no per-person passwords (D-034).
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        redirectURI: studioCallbackUrl(env),
      },
    },
    user: { modelName: STUDIO_AUTH_TABLES.user },
    session: {
      modelName: STUDIO_AUTH_TABLES.session,
      // D817 — cache the session in a signed short-lived cookie so the
      // busiest admin surfaces (workspace polling, SSE setup, autosaves)
      // stop paying an `auth_session` SELECT per request.
      //
      // TRADEOFF (deliberate, acceptable for an internal tool): revocation
      // latency. Within `maxAge` (60s) a request can be authorized from the
      // cookie without touching the DB, so "sign out everywhere" (D805's
      // revoke-all) and an allowlist removal (D804) take up to 60s to bite
      // on OTHER devices. D804's gate itself is unaffected — it runs at
      // session CREATION (sign-in), which always hits the DB; and the
      // device that clicks sign-out clears its own cookies immediately.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    account: { modelName: STUDIO_AUTH_TABLES.account },
    verification: { modelName: STUDIO_AUTH_TABLES.verification },
    // Team gate (D-034): block account creation for anyone outside the
    // Workspace domain / allowlist. Fires on the FIRST sign-in (user create).
    // D804: the session.create gate below re-fires the same check on EVERY
    // sign-in, so shrinking the allowlist revokes existing accounts' future
    // sign-ins too (user-create alone never re-fires for an existing row).
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email?: string | null }) => {
            if (!isAllowedStudioEmail(user.email, env)) {
              throw new APIError("FORBIDDEN", {
                message: "This Google account is not authorized for Studio.",
              });
            }
            // undefined → proceed unchanged.
            return undefined;
          },
        },
      },
      session: {
        create: {
          before: makeSessionCreateGate({ pool, env }),
        },
      },
    },
    advanced: {
      // host-only cookie (no Domain attr) is Better-auth's default — the
      // D-032 boundary keeps the Studio session off tenant hosts.
      cookiePrefix: "studio",
    },
  });
}

/** The concrete Studio Better-auth instance type (inferred from the factory). */
export type StudioAuth = ReturnType<typeof createStudioAuth>;

let cached: StudioAuth | null | undefined;

/**
 * Cached Studio Better-auth singleton for the running process: the configured
 * instance in "google" mode, or `null` in "dev"/"disabled" (no instance is
 * constructed without secrets, mirroring the AI stub). Mounting + session
 * checks treat `null` as "Google sign-in unavailable" and fall back to the
 * token / dev-session path.
 */
export function getStudioAuth(): StudioAuth | null {
  if (cached !== undefined) return cached;
  cached = resolveStudioAuthMode() === "google" ? createStudioAuth() : null;
  return cached;
}

/** Test hook — clears the cached singleton so a test can re-resolve the mode. */
export function __resetStudioAuthForTests(): void {
  cached = undefined;
}
