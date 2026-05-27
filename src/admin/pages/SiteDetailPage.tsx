import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { liveSiteUrl } from "../lib/siteUrl.js";
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
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Site detail shell (P4-T4.12). The URL routes by slug, but the detail/pages/
 * media endpoints key off the site UUID, so we resolve slug → id from the
 * already-cheap `GET /api/sites` list, then render `<SiteDetailView>` which
 * loads the full detail by id. Each tab mounts only when active, so its list
 * fetch is lazy (4.13–4.15 fill in the tab bodies).
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
  const [tab, setTab] = useState<TabKey>("pages");
  const { data, loading, error } = useApi<{ site: SiteDetail }>(`/api/sites/${siteId}`);
  const site = data?.site;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Sites
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{site?.display_name ?? slug}</h1>
            {site && <Badge tone={statusTone[site.status]}>{site.status}</Badge>}
          </div>
          <div className="flex items-center gap-3">
            {site && <SaveAsTemplateDialog siteId={site.id} siteName={site.display_name} />}
            <a
              href={liveSiteUrl(slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              View live site ↗
            </a>
          </div>
        </div>
        <p className="text-sm text-zinc-500">{slug}</p>
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
          <div role="tablist" className="flex gap-1 border-b border-zinc-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
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

          <div role="tabpanel">
            {tab === "pages" && <PagesTab siteId={site.id} slug={slug} />}
            {tab === "blog" && <BlogTab siteId={site.id} slug={slug} />}
            {tab === "events" && <EventsTab siteId={site.id} slug={slug} />}
            {tab === "members" && <MembersTab siteId={site.id} />}
            {tab === "media" && <MediaTab siteId={site.id} />}
            {tab === "plugins" && <PluginsTab siteId={site.id} />}
            {tab === "settings" && <SettingsTab site={site} />}
          </div>
        </>
      )}
    </div>
  );
}
