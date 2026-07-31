import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../ui/spinner.js";
import { clearSessionExpired } from "../lib/sessionExpiry.js";
import { SessionExpiredDialog } from "./SessionExpiredDialog.js";
import { useStudioSession } from "./useStudioSession.js";

/**
 * Route guard (P8-T8.5 — D-034). Verifies the admin via `GET /api/me`, which
 * works for all auth modes (Google session, X-Admin-Token, or local dev
 * auto-grant). While the probe is in flight it shows a spinner; on 401/error
 * it redirects to /login, preserving the attempted path AND query (D214 —
 * deep links like /sites/x?page=… are the contract PageEditRedirect mints).
 *
 * D800: a rejected Google sign-in lands back here as `/?error=…` (Better-auth
 * 302s the failed callback to the app root). The `error`/`error_description`
 * params are forwarded to /login's own query — where LoginPage renders a
 * human explanation — and stripped from the preserved `from`, so the
 * post-login destination doesn't re-carry a stale error.
 */
export function RequireAdmin() {
  const { status } = useStudioSession();
  const location = useLocation();

  // D801 — a fresh successful probe means whatever raised the shared
  // session-expired flag has been resolved (re-auth round-trip, token
  // re-paste); reset it so the dialog doesn't linger over a valid session.
  useEffect(() => {
    if (status === "authed") clearSessionExpired();
  }, [status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Spinner />
      </div>
    );
  }
  if (status === "unauthed") {
    const params = new URLSearchParams(location.search);
    const loginParams = new URLSearchParams();
    for (const key of ["error", "error_description"]) {
      const value = params.get(key);
      if (value) loginParams.set(key, value);
      params.delete(key);
    }
    const remaining = params.toString();
    const from = location.pathname + (remaining ? `?${remaining}` : "");
    return (
      <Navigate
        to={{ pathname: "/login", search: loginParams.toString() ? `?${loginParams}` : "" }}
        replace
        state={{ from }}
      />
    );
  }
  // D801: the expired-session dialog rides ALONGSIDE the outlet — when the
  // shared 401 signal fires mid-use it overlays the live SPA instead of
  // tearing it down, preserving unsaved editor state under it.
  return (
    <>
      <Outlet />
      <SessionExpiredDialog />
    </>
  );
}
