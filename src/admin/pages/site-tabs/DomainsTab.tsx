import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Dialog, DialogContent, DialogDescription } from "../../ui/dialog.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";

// D428 — client-side hostname validation before the round-trip: at least one
// dot, valid DNS labels, an alphabetic TLD. Matches the inline-validation
// pattern the slug fields elsewhere already use.
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Domains tab (P10-10.7; W2-DOM of the 2026-07-30 product audit).
 *
 * Lists all site_domains rows with DNS/SSL status badges and, honestly, the
 * outcomes of everything the operator can do here:
 *   - D400: every ProvisionResult step (cloud_run / dns, ok or error) is
 *     rendered under the card — a failed provision paints its failure.
 *   - D401/D402: Remove asks for confirmation naming the hostname and what
 *     unprovisioning does, and removal errors/warnings are surfaced.
 *   - D403: help copy explains managed vs client-owned, what Provision
 *     does, and the one-time Search Console (Webmaster Central)
 *     precondition — before the click, not as a click-time surprise.
 *   - D404: Check now — an explicit authoritative re-check per domain.
 *   - D609: a failed row renders its persisted last_error (with a Search
 *     Console link when that's the cause), not a bare 'failed' badge.
 *   - D110: Make primary — a custom domain can become the canonical live
 *     URL.
 */

type DomainRow = {
  id: string;
  hostname: string;
  is_primary: boolean;
  verification_status: "pending" | "verified" | "failed";
  ssl_status: "pending" | "active" | "failed";
  last_error: string | null;
  domain_class: "managed" | "client-owned";
  created_at: string;
};

type DnsRecord = { name: string; type: string; data: string };

type ProvisionStep = { step: string; status: string; detail?: string };

type ProvisionResult = {
  steps: ProvisionStep[];
  required_records: DnsRecord[];
};

const SEARCH_CONSOLE_URL = "https://search.google.com/search-console/settings";

const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  verified: "bg-green-100 text-green-800",
  active: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

function StatusBadge({ label }: { label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[label] ?? "bg-zinc-100 text-zinc-700"}`}>
      {label}
    </span>
  );
}

/** True when an error detail is the known Search-Console ownership failure. */
function isSearchConsoleError(detail: string): boolean {
  return /search-console|permission\s*denied|verified owner|not authorized to administer/i.test(detail);
}

function ErrorDetail({ detail }: { detail: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <p className="break-words">{detail}</p>
      {isSearchConsoleError(detail) && (
        <a
          href={SEARCH_CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-medium underline"
        >
          Open Google Search Console →
        </a>
      )}
    </div>
  );
}

const stepIcon: Record<string, { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-green-600" },
  error: { glyph: "✕", cls: "text-red-600" },
  skipped: { glyph: "–", cls: "text-zinc-400" },
};

/** D400: render every step outcome a provision attempt returned. */
function ProvisionSteps({ steps }: { steps: ProvisionStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-md border border-zinc-200 p-3" data-testid="provision-steps">
      <p className="mb-2 text-xs font-semibold text-zinc-700">Provision result</p>
      <ul className="flex flex-col gap-1">
        {steps.map((s, i) => {
          const icon = stepIcon[s.status] ?? stepIcon.skipped;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span aria-hidden className={`mt-0.5 font-bold ${icon.cls}`}>{icon.glyph}</span>
              <span className="font-mono text-zinc-700">{s.step}</span>
              <span className={s.status === "error" ? "text-red-700 break-words" : "text-zinc-500 break-words"}>
                {s.status}
                {s.detail ? ` — ${s.detail}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {steps.some((s) => s.status === "error" && isSearchConsoleError(s.detail ?? "")) && (
        <a
          href={SEARCH_CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-red-700 underline"
        >
          Open Google Search Console →
        </a>
      )}
    </div>
  );
}

/** D403: explain the domain classes, the Provision verb, and the known
 *  Search Console precondition where the buttons live. */
function DomainsHelp() {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-600">
      <p className="mb-2">
        <span className="font-semibold text-zinc-800">managed</span> — a hostname under our
        platform domain (…sites.anchorcorps.com). <span className="font-medium">Provision</span>{" "}
        creates its Cloud Run domain mapping and writes the DNS records into our zone
        automatically; nothing to do at a registrar.
      </p>
      <p className="mb-2">
        <span className="font-semibold text-zinc-800">client-owned</span> — a domain whose DNS
        you (or your client) control. <span className="font-medium">Provision</span> creates the
        Cloud Run mapping and then shows the exact DNS records to add at the external registrar;
        we never write into a zone we don't manage.
      </p>
      <p className="text-zinc-500">
        <span className="font-medium text-zinc-700">One-time prerequisite:</span> Cloud Run only
        accepts domain mappings after the app's runtime service account is a verified owner of
        the apex domain in{" "}
        <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noreferrer" className="underline">
          Google Search Console
        </a>{" "}
        (Webmaster Central). Until that's done, provisioning fails with PermissionDenied — the
        error below the domain will say exactly that.
      </p>
    </div>
  );
}

export function DomainsTab({ siteId }: { siteId: string }) {
  const domains = useApi<{ domains: DomainRow[] }>(`/api/sites/${siteId}/domains`);
  const [hostname, setHostname] = useState("");
  const hostnameTouched = hostname.trim().length > 0;
  const hostnameValid = HOSTNAME_RE.test(hostname.trim().toLowerCase());
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [provisionResults, setProvisionResults] = useState<Record<string, ProvisionResult>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<DomainRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [lastRemoval, setLastRemoval] = useState<{ hostname: string; warnings: string[] } | null>(
    null,
  );

  if (domains.loading) return <Spinner />;
  if (domains.error) return <p className="text-sm text-red-600">Couldn't load domains: {domains.error}</p>;

  const list = domains.data?.domains ?? [];

  function setBusy(domainId: string, busy: boolean) {
    setBusyMap((m) => ({ ...m, [domainId]: busy }));
  }
  function setActionError(domainId: string, message: string | null) {
    setActionErrors((m) => {
      const next = { ...m };
      if (message === null) delete next[domainId];
      else next[domainId] = message;
      return next;
    });
  }

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!HOSTNAME_RE.test(hostname.trim().toLowerCase())) return;
    setAddBusy(true);
    setAddError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/domains`, {
        method: "POST",
        body: { hostname: hostname.trim().toLowerCase() },
      });
      setHostname("");
      domains.reload();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add domain.");
    } finally {
      setAddBusy(false);
    }
  }

  // D401/D402/D119: confirmed removal with surfaced errors + warnings.
  async function removeDomain(domain: DomainRow) {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const result = await apiFetch<{ removed: boolean; warnings: string[] }>(
        `/api/sites/${siteId}/domains/${domain.id}`,
        { method: "DELETE" },
      );
      setLastRemoval({ hostname: domain.hostname, warnings: result?.warnings ?? [] });
      setConfirmRemove(null);
      domains.reload();
    } catch (err) {
      // D402: a failed removal must say so — never silently keep the row.
      const warnings =
        err instanceof ApiError &&
        err.body &&
        typeof err.body === "object" &&
        "warnings" in err.body &&
        Array.isArray((err.body as { warnings: unknown }).warnings)
          ? ((err.body as { warnings: string[] }).warnings)
          : [];
      const base = err instanceof Error ? err.message : "Couldn't remove domain.";
      setRemoveError([base, ...warnings].join(" — "));
    } finally {
      setRemoveBusy(false);
    }
  }

  async function provision(domainId: string) {
    setBusy(domainId, true);
    setActionError(domainId, null);
    try {
      const result = await apiFetch<ProvisionResult>(
        `/api/sites/${siteId}/domains/${domainId}/provision`,
        { method: "POST" },
      );
      setProvisionResults((r) => ({ ...r, [domainId]: result }));
      domains.reload();
    } catch (err) {
      setProvisionResults((r) => ({
        ...r,
        [domainId]: {
          steps: [{ step: "provision", status: "error", detail: err instanceof Error ? err.message : "failed" }],
          required_records: [],
        },
      }));
    } finally {
      setBusy(domainId, false);
    }
  }

  // D404: explicit authoritative re-check.
  async function checkNow(domainId: string) {
    setBusy(domainId, true);
    setActionError(domainId, null);
    try {
      await apiFetch(`/api/sites/${siteId}/domains/${domainId}/verify`, { method: "POST" });
      domains.reload();
    } catch (err) {
      setActionError(domainId, err instanceof Error ? err.message : "Check failed.");
    } finally {
      setBusy(domainId, false);
    }
  }

  // D110: promote a domain to primary (the canonical live URL).
  async function makePrimary(domainId: string) {
    setBusy(domainId, true);
    setActionError(domainId, null);
    try {
      await apiFetch(`/api/sites/${siteId}/domains/${domainId}/set-primary`, { method: "POST" });
      domains.reload();
    } catch (err) {
      setActionError(domainId, err instanceof Error ? err.message : "Couldn't make primary.");
    } finally {
      setBusy(domainId, false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <DomainsHelp />

      {/* D119: warnings from the most recent removal (the row is gone, but
          partial cleanup must not be silently forgotten). */}
      {lastRemoval && (
        <div
          className={`rounded-md border p-3 text-xs ${
            lastRemoval.warnings.length > 0
              ? "border-yellow-300 bg-yellow-50 text-yellow-900"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <p className="font-medium">Removed {lastRemoval.hostname}.</p>
          {lastRemoval.warnings.map((w, i) => (
            <p key={i} className="mt-1 break-words">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Domain list */}
      <div className="flex flex-col gap-3">
        {list.length === 0 && (
          <p className="text-sm text-zinc-500">No domains configured yet.</p>
        )}
        {list.map((d) => (
          <DomainCard
            key={d.id}
            domain={d}
            busy={!!busyMap[d.id]}
            onProvision={() => provision(d.id)}
            onCheckNow={() => checkNow(d.id)}
            onMakePrimary={() => makePrimary(d.id)}
            onRemove={() => {
              setRemoveError(null);
              setConfirmRemove(d);
            }}
            provisionResult={provisionResults[d.id]}
            actionError={actionErrors[d.id]}
          />
        ))}
      </div>

      {/* Add domain form */}
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={addDomain} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="add-domain-hostname">Add custom domain</Label>
              <div className="flex gap-2">
                <Input
                  id="add-domain-hostname"
                  placeholder="www.example.com"
                  value={hostname}
                  aria-invalid={hostnameTouched && !hostnameValid ? true : undefined}
                  onChange={(e) => {
                    setAddError(null);
                    setHostname(e.target.value);
                  }}
                  className="flex-1"
                />
                <Button type="submit" disabled={addBusy || !hostnameValid}>
                  {addBusy ? <Spinner /> : "Add domain"}
                </Button>
              </div>
            </div>
            {hostnameTouched && !hostnameValid && (
              <p className="text-xs text-red-600">
                Enter a full hostname like <span className="font-mono">www.example.com</span> — a
                domain with at least one dot and a valid extension.
              </p>
            )}
            {addError && <p className="text-sm text-red-600">{addError}</p>}
          </form>
        </CardContent>
      </Card>

      {/* D401: confirm before the destructive, hard-to-reprovision removal. */}
      <Dialog open={confirmRemove !== null} onOpenChange={(next) => !next && setConfirmRemove(null)}>
        {confirmRemove && (
          <DialogContent title={`Remove ${confirmRemove.hostname}?`}>
            <DialogDescription>
              This unprovisions the domain: the Cloud Run domain mapping is deleted and any DNS
              records we created for it are removed, so{" "}
              <span className="font-mono">{confirmRemove.hostname}</span> stops serving this site.
              You can add and provision it again later.
            </DialogDescription>
            {removeError && (
              <p className="mt-3 text-sm text-red-600 break-words">{removeError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)} disabled={removeBusy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => removeDomain(confirmRemove)}
                disabled={removeBusy}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {removeBusy ? <Spinner /> : "Remove domain"}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function DomainCard({
  domain,
  busy,
  onProvision,
  onCheckNow,
  onMakePrimary,
  onRemove,
  provisionResult,
  actionError,
}: {
  domain: DomainRow;
  busy: boolean;
  onProvision: () => void;
  onCheckNow: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
  provisionResult?: ProvisionResult;
  actionError?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="font-mono text-sm font-medium break-all">{domain.hostname}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                {domain.domain_class}
              </span>
              {domain.is_primary && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  primary
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex flex-col gap-1 items-end">
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                DNS: <StatusBadge label={domain.verification_status} />
              </div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                SSL: <StatusBadge label={domain.ssl_status} />
              </div>
            </div>
          </div>
        </div>

        {/* D609: the persisted failure detail — with its forward path —
            instead of a bare 'failed' badge. */}
        {domain.last_error && <ErrorDetail detail={domain.last_error} />}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onProvision}>
            {busy ? <Spinner /> : "Provision"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onCheckNow}>
            Check now
          </Button>
          {!domain.is_primary && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={onMakePrimary}>
                Make primary
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onRemove}
                className="text-red-600 hover:text-red-700"
              >
                Remove
              </Button>
            </>
          )}
        </div>

        {actionError && <p className="text-xs text-red-600 break-words">{actionError}</p>}

        {provisionResult && <ProvisionSteps steps={provisionResult.steps} />}

        {provisionResult && provisionResult.required_records.length > 0 && (
          <div className="mt-1 rounded-md border border-zinc-200 p-3">
            <p className="mb-2 text-xs font-semibold text-zinc-700">
              Required DNS records — add these at your DNS registrar:
            </p>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pr-3">Name</th>
                  <th className="pr-3">Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {provisionResult.required_records.map((rec, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-1 pr-3 break-all">{rec.name}</td>
                    <td className="py-1 pr-3">{rec.type}</td>
                    <td className="py-1 break-all">{rec.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
