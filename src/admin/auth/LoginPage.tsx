import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { setAdminToken } from "../lib/adminToken.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";

/**
 * Token paste screen (P4-T4.8). Verifies the pasted token against a
 * lightweight `GET /api/sites` probe before persisting it, so a bad
 * token surfaces an error here instead of on the first real action.
 */
export function LoginPage() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    // Temporarily set the token so apiFetch attaches it for the probe,
    // then clear it if the probe fails.
    setAdminToken(value.trim());
    try {
      await apiFetch("/api/sites");
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // apiFetch already cleared the token on 401.
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
          <p className="text-sm text-zinc-500">Paste your admin token to continue.</p>
        </CardHeader>
        <CardContent>
          {/* Not a CRM form — this is the admin auth gate; no PHI, no CTM. */}
          <form onSubmit={submit} className="flex flex-col gap-3">
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? <Spinner /> : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
