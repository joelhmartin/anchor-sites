import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAdminToken } from "../lib/adminToken.js";

/**
 * Route guard (P4-T4.8). Redirects to /login when no admin token is
 * stored. On 401 inside apiFetch the token is cleared, which re-renders
 * this guard and bounces the user out. Preserves the attempted path in
 * location state so /login can return there.
 */
export function RequireAdmin() {
  const { token } = useAdminToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
