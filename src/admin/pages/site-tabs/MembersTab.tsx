import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Dialog, DialogContent, DialogDescription } from "../../ui/dialog.js";
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
 * Members / Auth tab (P8-T8.13, D-048). This site's member accounts
 * (`tenant_auth_user`, site-scoped) with a per-row Remove action (D423), plus
 * a per-site login-provider toggle backed by `tenant_auth_config` that warns
 * before turning off the only sign-in method (D424).
 */
export function MembersTab({ siteId }: { siteId: string }) {
  const members = useApi<{ members: Member[] }>(`/api/sites/${siteId}/members`);
  const config = useApi<AuthConfig>(`/api/sites/${siteId}/auth-config`);

  const [emailPassword, setEmailPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D424 — confirm before disabling the last enabled provider.
  const [confirmDisable, setConfirmDisable] = useState(false);
  // D423 — the member queued for removal (confirm dialog).
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Seed the toggle from the loaded config (default on).
  useEffect(() => {
    if (config.data) setEmailPassword(config.data.providers.emailPassword !== false);
  }, [config.data]);

  const rows = members.data?.members ?? [];

  async function persist() {
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
      setConfirmDisable(false);
    }
  }

  function save() {
    // D424 — email+password is the sole v1 provider; turning it off locks every
    // member out. Confirm (with the member count) before committing.
    if (!emailPassword) {
      setConfirmDisable(true);
      return;
    }
    void persist();
  }

  async function removeMember(member: Member) {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/members/${member.id}`, { method: "DELETE" });
      setConfirmRemove(null);
      members.reload();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn’t remove this member.");
    } finally {
      setRemoveBusy(false);
    }
  }

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
                  <TH>{""}</TH>
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
                    <TD>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRemoveError(null);
                          setConfirmRemove(m);
                        }}
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* D423 — confirm removing a member (deletes their account + sessions). */}
      <Dialog open={confirmRemove !== null} onOpenChange={(next) => !next && setConfirmRemove(null)}>
        {confirmRemove && (
          <DialogContent title={`Remove ${confirmRemove.name || confirmRemove.email}?`}>
            <DialogDescription>
              This permanently deletes <span className="font-medium">{confirmRemove.email}</span>’s
              account and signs them out. They can sign up again unless the site is closed to new
              members.
            </DialogDescription>
            {removeError && <p className="mt-3 text-sm text-red-600">{removeError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)} disabled={removeBusy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => removeMember(confirmRemove)} disabled={removeBusy}>
                {removeBusy ? <Spinner /> : "Remove member"}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* D424 — confirm disabling the only sign-in method. */}
      <Dialog open={confirmDisable} onOpenChange={(next) => !next && setConfirmDisable(false)}>
        <DialogContent title="Turn off the only login method?">
          <DialogDescription>
            Email + password is the only way members sign in to this site. Turning it off locks out
            {" "}
            <span className="font-medium">
              {rows.length} {rows.length === 1 ? "member" : "members"}
            </span>{" "}
            — no one will be able to log in until you turn a provider back on.
          </DialogDescription>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDisable(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void persist()} disabled={busy}>
              {busy ? <Spinner /> : "Disable anyway"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
