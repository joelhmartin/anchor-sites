import { apiFetch } from "./apiFetch.js";
import { clearAdminToken } from "./adminToken.js";

/**
 * Studio session helpers (P8-T8.5 — D-034). The client treats auth uniformly
 * across modes: `fetchMe` hits `/api/me` (200 → authed, 401 → not), Google
 * sign-in is started via Better-auth's social endpoint, and sign-out clears
 * both the server session and any break-glass token.
 */

export type StudioUser = { id: string; email: string; name?: string | null };

/** Resolve the current admin (or null on 401). Throws on network errors. */
export async function fetchMe(): Promise<StudioUser | null> {
  const { user } = await apiFetch<{ user: StudioUser | null }>("/api/me");
  return user;
}

/**
 * Begin Google OAuth via Better-auth's social sign-in. It returns the Google
 * authorization URL; we navigate the browser there. After Google calls back to
 * `/auth/google/callback`, Better-auth sets the session cookie and redirects to
 * `callbackURL`.
 */
export async function signInWithGoogle(callbackURL = "/"): Promise<void> {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    // D800: `errorCallbackURL` routes a REJECTED callback (denied consent,
    // allowlist rejection) straight to /login?error=…, where LoginPage
    // explains it — instead of Better-auth's default bounce to `/?error=…`
    // (which only reaches /login via RequireAdmin's forwarding).
    body: JSON.stringify({ provider: "google", callbackURL, errorCallbackURL: "/login" }),
  });
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!res.ok || !data?.url) {
    throw new Error("Could not start Google sign-in. Is OAuth configured?");
  }
  window.location.assign(data.url);
}

/**
 * D814 — which sign-in methods can this deployment actually honor? Reads the
 * unauthenticated `/api/auth-mode` discovery endpoint. Falls back to
 * `"google"` when the endpoint is missing (older deployment) or unreachable —
 * i.e. keep offering the button rather than hiding a path that might work.
 */
export type StudioAuthModeClient = "google" | "dev" | "disabled";

export async function fetchAuthMode(): Promise<StudioAuthModeClient> {
  try {
    const { mode } = await apiFetch<{ mode?: string }>("/api/auth-mode");
    return mode === "dev" || mode === "disabled" ? mode : "google";
  } catch {
    return "google";
  }
}

/** End the session server-side and clear any local break-glass token. */
export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" }).catch(
    () => undefined,
  );
  clearAdminToken();
}
