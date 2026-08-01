import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { liveSiteUrl } from "../lib/siteUrl.js";
import { hasPlaceholderMarker } from "../../shared/public-name.js";
import type { SiteDetail, SiteListRow, SiteStatus } from "../lib/siteTypes.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";
import { PagesTab } from "./site-tabs/PagesTab.js";
import { BlogTab } from "./site-tabs/BlogTab.js";
import { EventsTab } from "./site-tabs/EventsTab.js";
import { MediaTab } from "./site-tabs/MediaTab.js";
import { SettingsTab } from "./site-tabs/SettingsTab.js";
import { PluginsTab } from "./site-tabs/PluginsTab.js";
import { MembersTab } from "./site-tabs/MembersTab.js";
import { SeoSettingsTab } from "./site-tabs/SeoSettingsTab.js";
import { DomainsTab } from "./site-tabs/DomainsTab.js";
import { CrmTab } from "./site-tabs/CrmTab.js";
import { SaveAsTemplateDialog } from "../components/SaveAsTemplateDialog.js";

const statusTone: Record<SiteStatus, "success" | "neutral" | "warning"> = {
  active: "success",
  archived: "neutral",
  suspended: "warning",
};

const TABS = [
  { key: "pages", label: "Pages" },
  { key: "blog", label: "Blog" },
  { key: "events", label: "Events" },
  { key: "members", label: "Members" },
  { key: "media", label: "Media" },
  { key: "plugins", label: "Plugins" },
  { key: "domains", label: "Domains" },
  { key: "integrations", label: "Integrations" },
  { key: "seo", label: "SEO" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Site management shell (P4-T4.12; served at `/sites/:slug/manage` since
 * Task B2, 2026-07-30 lovable-workspace SDD — `/sites/:slug` itself is now
 * the Lovable-style workspace, `WorkspacePage.tsx`). The URL routes by slug,
 * but the detail/pages/media endpoints key off the site UUID, so we resolve
 * slug → id from the already-cheap `GET /api/sites` list, then render
 * `<SiteDetailView>` which loads the full detail by id. Each tab mounts only
 * when active, so its list fetch is lazy (4.13–4.15 fill in the tab bodies).
 */
export function SiteDetailPage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Spinner /> Loading site…
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm text-red-600">Couldn’t load sites: {error}</CardContent>
      </Card>
    );
  }

  const row = data?.sites.find((s) => s.slug === slug);
  if (!row) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-5">
          <p className="text-sm text-zinc-600">No site found for “{slug}”.</p>
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Back to sites
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <SiteDetailView siteId={row.id} slug={row.slug} />;
}

function SiteDetailView({ siteId, slug }: { siteId: string; slug: string }) {
  // D321 — `?tab=domains` (etc.) deep-links straight to a tab, so success
  // states elsewhere (e.g. the workspace publish popover's "Connect a
  // domain") can hand the operator the exact surface they need. Unknown
  // values fall back to the default.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = TABS.some((t) => t.key === requestedTab)
    ? (requestedTab as TabKey)
    : "pages";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const { data, loading, error, reload } = useApi<{ site: SiteDetail }>(`/api/sites/${siteId}`);
  const site = data?.site;

  // D412 — complete the ARIA tabs contract: roving tabindex + arrow-key
  // navigation across the tablist (Left/Right wrap, Home/End jump), plus
  // id/aria-controls/aria-labelledby wiring below.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Sites
          </Link>
          {/* D411 — name the other surface and the split. Manage previously
              only pointed outward ("Sites"/"View live"); the workspace linked
              here but never back. */}
          <Link
            to={`/sites/${slug}`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Open workspace →
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{site?.display_name ?? slug}</h1>
            {site && <Badge tone={statusTone[site.status]}>{site.status}</Badge>}
          </div>
          <div className="flex items-center gap-3">
            {site && <SaveAsTemplateDialog siteId={site.id} siteName={site.display_name} />}
            {/* D923 — never present the URL as live before the primary
                domain's mapping is Ready (unprovisioned hostnames TLS-refuse,
                verified live). Same href either way; honest labeling. */}
            {site &&
              (site.live_url_ready ? (
                <a
                  href={site.live_url ?? liveSiteUrl(slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  View live site ↗
                </a>
              ) : site.live_url ? (
                <a
                  href={site.live_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-zinc-400 hover:text-zinc-500"
                >
                  Site provisioning… (check Domains) ↗
                </a>
              ) : (
                <span className="text-sm text-zinc-400">No domain connected — see Domains</span>
              ))}
          </div>
        </div>
        <p className="text-sm text-zinc-500">{slug}</p>
        <p className="text-xs text-zinc-400">
          Design pages and content in the <strong>workspace</strong>; manage settings, domains,
          members, and integrations here.
        </p>
        {/* D911 — the live render strips the "(placeholder)" seed marker from
            public surfaces, but the honest fix is a real name; keep nudging
            until the operator renames. */}
        {site && hasPlaceholderMarker(site.display_name) && (
          <p className="text-xs text-amber-600">
            “(placeholder)” won’t appear on the live site — rename this site to its real name in
            Settings.
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading…
        </div>
      )}
      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load this site: {error}</CardContent>
        </Card>
      )}

      {site && (
        <>
          <div role="tablist" aria-label="Site management sections" className="flex gap-1 border-b border-zinc-200">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`tab-${t.key}`}
                role="tab"
                aria-selected={tab === t.key}
                aria-controls={`tabpanel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                  tab === t.key
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-zinc-500 hover:text-zinc-700",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`tabpanel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            tabIndex={0}
            className="min-w-0 flex-1"
          >
            {tab === "pages" && <PagesTab siteId={site.id} slug={slug} />}
            {tab === "blog" && <BlogTab siteId={site.id} slug={slug} />}
            {tab === "events" && <EventsTab siteId={site.id} slug={slug} />}
            {tab === "members" && <MembersTab siteId={site.id} />}
            {tab === "media" && <MediaTab siteId={site.id} />}
            {tab === "plugins" && <PluginsTab siteId={site.id} />}
            {tab === "domains" && <DomainsTab siteId={site.id} />}
            {tab === "integrations" && <CrmTab site={site} />}
            {tab === "seo" && <SeoSettingsTab site={site} />}
            {tab === "settings" && <SettingsTab site={site} onSiteChanged={reload} />}
          </div>
        </>
      )}
    </div>
  );
}

