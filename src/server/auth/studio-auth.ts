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
    session: { modelName: STUDIO_AUTH_TABLES.session },
    account: { modelName: STUDIO_AUTH_TABLES.account },
    verification: { modelName: STUDIO_AUTH_TABLES.verification },
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
