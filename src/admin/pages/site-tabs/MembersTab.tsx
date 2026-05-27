import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Spinner } from "../../ui/spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../ui/table.js";

type Member = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  created_at: string;
};
type AuthConfig = { providers: { emailPassword?: boolean } };

/**
 * Members / Auth tab (P8-T8.13, D-048). Read-only view of this site's member
 * accounts (`tenant_auth_user`, site-scoped) plus a per-site login-provider
 * toggle backed by `tenant_auth_config`. v1 exposes the email+password
 * provider; social providers (per-site client IDs) are a later refinement.
 */
export function MembersTab({ siteId }: { siteId: string }) {
  const members = useApi<{ members: Member[] }>(`/api/sites/${siteId}/members`);
  const config = useApi<AuthConfig>(`/api/sites/${siteId}/auth-config`);

  const [emailPassword, setEmailPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the toggle from the loaded config (default on).
  useEffect(() => {
    if (config.data) setEmailPassword(config.data.providers.emailPassword !== false);
  }, [config.data]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/api/sites/${siteId}/auth-config`, {
        method: "PUT",
        body: { providers: { emailPassword } },
      });
      setSaved(true);
      config.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save auth settings.");
    } finally {
      setBusy(false);
    }
  }

  const rows = members.data?.members ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Members &amp; Auth</h2>

      {/* Login providers */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <p className="text-sm font-medium">Login providers</p>
          {config.loading ? (
            <Spinner />
          ) : config.error ? (
            <p className="text-sm text-red-600">{config.error}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Email + password"
                  checked={emailPassword}
                  onChange={(e) => {
                    setSaved(false);
                    setEmailPassword(e.target.checked);
                  }}
                />
                Email + password
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={save} disabled={busy}>
                  {busy ? <Spinner /> : "Save"}
                </Button>
                {saved && <span className="text-sm text-green-600">Saved.</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      {members.loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading members…
        </div>
      )}
      {members.error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load members: {members.error}</CardContent>
        </Card>
      )}
      {!members.loading && !members.error && rows.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No members yet. Visitors who sign up on this site appear here.
          </CardContent>
        </Card>
      )}
      {!members.loading && !members.error && rows.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Verified</TH>
                  <TH>Joined</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium text-zinc-900">{m.name}</TD>
                    <TD>{m.email}</TD>
                    <TD>
                      <Badge tone={m.email_verified ? "success" : "neutral"}>
                        {m.email_verified ? "verified" : "unverified"}
                      </Badge>
                    </TD>
                    <TD>{new Date(m.created_at).toLocaleDateString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
