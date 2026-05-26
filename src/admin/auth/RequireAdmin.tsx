import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../ui/spinner.js";
import { useStudioSession } from "./useStudioSession.js";

/**
 * Route guard (P8-T8.5 — D-034). Verifies the admin via `GET /api/me`, which
 * works for all auth modes (Google session, X-Admin-Token, or local dev
 * auto-grant). While the probe is in flight it shows a spinner; on 401/error
 * it redirects to /login, preserving the attempted path.
 */
export function RequireAdmin() {
  const { status } = useStudioSession();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Spinner />
      </div>
    );
  }
  if (status === "unauthed") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
