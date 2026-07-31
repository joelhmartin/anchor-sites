import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { setAdminToken } from "../lib/adminToken.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { fetchMe, signInWithGoogle } from "../lib/session.js";

/**
 * D800 — translate Better-auth's `?error=` codes into human explanations.
 * Known sources (verified against better-auth 1.6.11's shipped callback):
 *   - `access_denied` — the user cancelled/denied at Google's consent screen.
 *   - `unable_to_create_session` — D804's session-create allowlist gate
 *     returned false (an existing account whose allowlist entry was removed).
 *   - the user-create hook's thrown APIError message, underscored by the
 *     callback (`This_Google_account_is_not_authorized_for_Studio.`) — a
 *     brand-new account outside the domain/allowlist.
 * Unknown codes fall back to the decoded text so the operator still sees
 * SOMETHING rather than a pristine login page.
 */
function describeAuthError(code: string): string {
  const decoded = code.replace(/_/g, " ").replace(/\.$/, "");
  if (code === "access_denied") {
    return "Google sign-in was cancelled or didn't finish. Nothing was changed — you can try again.";
  }
  if (
    code === "unable_to_create_session" ||
    code === "unable_to_create_user" ||
    code === "signup_disabled" ||
    /not authorized/i.test(decoded)
  ) {
    return "That Google account isn't authorized for Studio. Ask an admin to add you to the allowlist, then sign in again.";
  }
  if (["state_not_found", "state_mismatch", "invalid_code", "please_restart_the_process"].includes(code)) {
    return "The sign-in attempt expired or got out of sync. Start again from this page.";
  }
  return `Sign-in failed (${decoded}). Try again, or use an admin token.`;
}

/**
 * Studio sign-in (P8-T8.5 — D-034). Primary path is "Sign in with Google"
 * (team-gated by the server). A break-glass admin-token form is revealed via
 * `?mode=token` or the "Use an admin token" link — it verifies the pasted
 * token against `/api/me` before persisting it.
 *
 * D800: `?error=` (forwarded by RequireAdmin from Better-auth's rejected-
 * callback redirect, or set directly via signInWithGoogle's
 * errorCallbackURL) renders a human explanation above the sign-in options.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const searchParams = new URLSearchParams(location.search);
  const tokenModeDefault = searchParams.get("mode") === "token";
  const authErrorCode = searchParams.get("error");

  const [tokenMode, setTokenMode] = useState(tokenModeDefault);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(from);
      // signInWithGoogle navigates away on success; if it returns, it threw.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    // Set the token so apiFetch attaches it for the probe; cleared on 401.
    setAdminToken(value.trim());
    try {
      await fetchMe();
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("That token was rejected. Check it and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>AnchorCorps Studio</CardTitle>
          <p className="text-sm text-zinc-500">Sign in to manage your sites.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {authErrorCode && (
              <p
                data-testid="auth-error"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {describeAuthError(authErrorCode)}
              </p>
            )}
            <Button type="button" onClick={startGoogle} disabled={busy}>
              {busy && !tokenMode ? <Spinner /> : "Sign in with Google"}
            </Button>

            {tokenMode ? (
              // Not a CRM form — admin auth gate; no PHI, no CTM.
              <form onSubmit={submitToken} className="mt-2 flex flex-col gap-3 border-t border-zinc-200 pt-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="admin-token">Admin token</Label>
                  <Input
                    id="admin-token"
                    type="password"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="X-Admin-Token"
                  />
                </div>
                <Button type="submit" variant="outline" disabled={busy || !value.trim()}>
                  {busy ? <Spinner /> : "Use token"}
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setTokenMode(true)}
                className="text-xs text-zinc-400 hover:text-zinc-600"
              >
                Use an admin token instead
              </button>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
