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
 * Studio sign-in (P8-T8.5 — D-034). Primary path is "Sign in with Google"
 * (team-gated by the server). A break-glass admin-token form is revealed via
 * `?mode=token` or the "Use an admin token" link — it verifies the pasted
 * token against `/api/me` before persisting it.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const tokenModeDefault = new URLSearchParams(location.search).get("mode") === "token";

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
