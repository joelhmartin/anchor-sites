import { useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Spinner } from "../../ui/spinner.js";

/**
 * Domains tab (P10-10.7). Lists all site_domains rows with DNS/SSL status
 * badges. Lets the operator add a custom hostname, trigger Cloud Run mapping +
 * DNS provisioning, view required DNS records for client-owned zones, and
 * remove non-primary domains (best-effort unprovision). The primary managed
 * subdomain is shown but cannot be removed from here.
 */

type DomainRow = {
  id: string;
  hostname: string;
  is_primary: boolean;
  verification_status: "pending" | "verified" | "failed";
  ssl_status: "pending" | "active" | "failed";
  domain_class: "managed" | "client-owned";
  created_at: string;
};

type DnsRecord = { name: string; type: string; data: string };

type ProvisionResult = {
  steps: Array<{ step: string; status: string; detail?: string }>;
  required_records: DnsRecord[];
};

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

export function DomainsTab({ siteId }: { siteId: string }) {
  const domains = useApi<{ domains: DomainRow[] }>(`/api/sites/${siteId}/domains`);
  const [hostname, setHostname] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [provisionResults, setProvisionResults] = useState<Record<string, ProvisionResult>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});

  if (domains.loading) return <Spinner />;
  if (domains.error) return <p className="text-sm text-red-600">Couldn't load domains: {domains.error}</p>;

  const list = domains.data?.domains ?? [];

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!hostname.trim()) return;
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

  async function removeDomain(domainId: string) {
    setBusyMap((m) => ({ ...m, [domainId]: true }));
    try {
      await apiFetch(`/api/sites/${siteId}/domains/${domainId}`, { method: "DELETE" });
      domains.reload();
    } catch {
      // Ignore — UI will refresh on next reload
    } finally {
      setBusyMap((m) => ({ ...m, [domainId]: false }));
    }
  }

  async function provision(domainId: string) {
    setBusyMap((m) => ({ ...m, [domainId]: true }));
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
          steps: [{ step: "error", status: "error", detail: err instanceof Error ? err.message : "failed" }],
          required_records: [],
        },
      }));
    } finally {
      setBusyMap((m) => ({ ...m, [domainId]: false }));
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
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
            onRemove={() => removeDomain(d.id)}
            provisionResult={provisionResults[d.id]}
          />
        ))}
      </div>

      {/* Add domain form */}
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={addDomain} className="flex flex-col gap-3">
            <p className="text-sm font-medium">Add custom domain</p>
            <div className="flex gap-2">
              <Input
                placeholder="hostname (e.g. www.example.com)"
                value={hostname}
                onChange={(e) => {
                  setAddError(null);
                  setHostname(e.target.value);
                }}
                className="flex-1"
              />
              <Button type="submit" disabled={addBusy || !hostname.trim()}>
                {addBusy ? <Spinner /> : "Add domain"}
              </Button>
            </div>
            {addError && <p className="text-sm text-red-600">{addError}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DomainCard({
  domain,
  busy,
  onProvision,
  onRemove,
  provisionResult,
}: {
  domain: DomainRow;
  busy: boolean;
  onProvision: () => void;
  onRemove: () => void;
  provisionResult?: ProvisionResult;
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

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onProvision}
          >
            {busy ? <Spinner /> : "Provision"}
          </Button>
          {!domain.is_primary && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onRemove}
              className="text-red-600 hover:text-red-700"
            >
              Remove
            </Button>
          )}
        </div>

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
