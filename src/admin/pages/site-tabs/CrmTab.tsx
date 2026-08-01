import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import type { SiteDetail } from "../../lib/siteTypes.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Spinner } from "../../ui/spinner.js";

type PhoneNumber = {
  id: string;
  number: string;
  display: string;
  trackingType?: string;
};

type PhoneNumbersResponse = {
  phone_numbers: PhoneNumber[];
};

function BlockUsageCard() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5">
        <h3 className="text-sm font-semibold text-zinc-700">Block usage</h3>
        <p className="text-xs text-zinc-500">
          <strong>PhoneNumber block</strong> — Add a <code>phone_number</code> block to any page.
          CTM will swap the displayed number at runtime using the CTM account ID set in{" "}
          <strong>Settings → CTM account ID</strong>.
        </p>
        <p className="text-xs text-zinc-500">
          <strong>CRM Form block</strong> — Add a <code>crm_form</code> block and paste the embed
          code from anchor-hub. The form renders on the live page; the editor shows a placeholder.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Copy-to-clipboard control (D437). The old inline handler gave zero feedback
 * on success and swallowed clipboard failure — an operator couldn't tell
 * whether the number reached the clipboard. This shows a transient "Copied"
 * (announced via aria-live) on success and a "Copy failed" on rejection.
 */
function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <span className="flex items-center gap-2">
      <span aria-live="polite" className="text-xs text-zinc-500">
        {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : ""}
      </span>
      <button
        type="button"
        className="text-xs text-indigo-600 hover:text-indigo-700"
        onClick={copy}
      >
        Copy
      </button>
    </span>
  );
}

function PhoneNumbersCard({ siteId }: { siteId: string }) {
  const { data, loading, error } = useApi<PhoneNumbersResponse>(
    `/api/sites/${siteId}/crm/phone-numbers`,
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <h3 className="text-sm font-semibold text-zinc-700">Tracking phone numbers</h3>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Spinner /> Loading…
          </div>
        )}
        {error && <p className="text-sm text-red-600">Couldn't load phone numbers: {error}</p>}
        {!loading && !error && (
          <>
            {data?.phone_numbers && data.phone_numbers.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {data.phone_numbers.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded border border-zinc-200 px-3 py-2"
                  >
                    <span className="font-mono text-sm text-zinc-700">{p.display || p.number}</span>
                    <CopyButton value={p.number} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-400">
                No tracking numbers yet. Configure them in anchor-hub.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * P11-T11.8 (D-053) — Studio Integrations (CRM) tab.
 *
 * Shows the site's CRM link, tracking phone numbers, and usage notes
 * for crm_form + PhoneNumber blocks. Read-only proxy via GET /api/sites/:id/crm/phone-numbers.
 */
function UnprovisionedCrmCard({ siteId }: { siteId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/crm/provision`, { method: "POST", body: {} });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't provision CRM. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* D425 — operator-appropriate copy: no infrastructure secret names in a
          product surface, and a real retry action instead of "recreate the
          site". */}
      <p className="text-sm text-zinc-500">
        This site isn't connected to anchor-hub yet, so tracking numbers and forms aren't
        available. Connection usually happens automatically when the site is created; if it
        didn't, retry it here.
      </p>
      {done ? (
        <p className="text-sm text-green-700">
          Connection requested. Reload this tab in a moment to see the CRM details.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={retry} disabled={busy}>
            {busy ? <Spinner /> : "Retry CRM connection"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}
    </>
  );
}

export function CrmTab({ site }: { site: SiteDetail }) {
  const hascrm = Boolean(site.crm_site_id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <h3 className="text-sm font-semibold text-zinc-700">CRM site</h3>
          {hascrm ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">CRM site ID:</span>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">
                  {site.crm_site_id}
                </code>
              </div>
              <p className="text-xs text-zinc-400">
                Manage campaigns, forms, and tracking numbers in <strong>anchor-hub</strong>.
              </p>
            </>
          ) : (
            <UnprovisionedCrmCard siteId={site.id} />
          )}
        </CardContent>
      </Card>

      {hascrm && <PhoneNumbersCard siteId={site.id} />}

      <BlockUsageCard />
    </div>
  );
}
