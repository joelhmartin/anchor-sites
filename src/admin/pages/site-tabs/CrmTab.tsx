import { useApi } from "../../lib/useApi.js";
import type { SiteDetail } from "../../lib/siteTypes.js";
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
                    <button
                      type="button"
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                      onClick={() => navigator.clipboard.writeText(p.number).catch(() => undefined)}
                    >
                      Copy
                    </button>
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
            <p className="text-sm text-zinc-500">
              This site has not been provisioned in the CRM yet. Create the site to trigger
              auto-provisioning, or check the <strong>CRM_BASE_URL</strong> /{" "}
              <strong>CRM_API_KEY</strong> secrets.
            </p>
          )}
        </CardContent>
      </Card>

      {hascrm && <PhoneNumbersCard siteId={site.id} />}

      <BlockUsageCard />
    </div>
  );
}
