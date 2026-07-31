import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/button.js";
import { signInWithGoogle } from "../lib/session.js";
import { useSessionExpired } from "../lib/sessionExpiry.js";

/**
 * D801 — the "session expired" re-auth surface.
 *
 * Mounted by `RequireAdmin` ALONGSIDE the app outlet, so when apiFetch's
 * shared 401 signal fires this renders as an overlay OVER the live SPA —
 * nothing unmounts, unsaved editor state stays exactly where it was, and the
 * operator gets an explicit way back in instead of silently-failing retries.
 *
 * Re-auth paths:
 *   - "Sign in with Google" restarts OAuth with the CURRENT path+query as
 *     the callback, so the round-trip lands back on this exact screen. The
 *     OAuth redirect necessarily reloads the SPA — but the alternative
 *     (doing nothing) loses the same unsaved work plus the operator's time.
 *   - "Use an admin token" goes to /login?mode=token with `from` preserved
 *     (same contract as RequireAdmin's redirect, D214).
 *
 * Deliberately NOT dismissible: every admin request 401s until re-auth, so a
 * "keep editing" affordance would be a lie (the D807/D815 family is what
 * stops the background loops from hammering meanwhile).
 */
export function SessionExpiredDialog() {
  const expired = useSessionExpired();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!expired) return null;

  const here = location.pathname + location.search;

  async function startGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(here);
      // navigates away on success; if it returns, it threw
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      data-testid="session-expired-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
    >
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
        <h2 id="session-expired-title" className="text-base font-semibold text-zinc-900">
          Session expired — sign in again
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Your sign-in lapsed while you were working. This page is still here behind this
          dialog — sign in again to keep going. Anything not yet saved will save after
          you're back.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" onClick={startGoogle} disabled={busy}>
            {busy ? "Redirecting…" : "Sign in with Google"}
          </Button>
          <button
            type="button"
            onClick={() => navigate("/login?mode=token", { state: { from: here } })}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            Use an admin token instead
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
