import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Puck } from "../../editor/index.js";
import "@measured/puck/puck.css";
import { buildPuckConfig } from "../../editor/puck-config.js";
import { fromPuckData, toPuckData } from "../../editor/puck-adapter.js";
import type { Block } from "../../blocks/types.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import { liveSiteUrl } from "../lib/siteUrl.js";
import type { SiteListRow } from "../lib/siteTypes.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";

type PageDetail = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  status: string;
  blocks: Block[] | null;
  seo: Record<string, unknown> | null;
};

/**
 * Visual editor route (P5-T5.5 / D-017). Replaces the Phase-4 placeholder at
 * `/sites/:slug/pages/:pageId`. Resolves slug → site (the Phase-4 client-side
 * pattern), loads the page's blocks, converts to Puck `Data`, and renders the
 * Puck editor. Publishing converts back to `Block[]` and saves through the
 * existing revision API. `Block[]` stays the source of truth (D-001).
 */
export function EditorPage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) return <CenteredSpinner label="Loading…" />;
  if (error) return <ErrorCard message={`Couldn’t load sites: ${error}`} />;

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

  return <EditorView siteId={row.id} slug={row.slug} />;
}

function EditorView({ siteId, slug }: { siteId: string; slug: string }) {
  const { pageId } = useParams();
  const { data, loading, error } = useApi<{ page: PageDetail }>(
    `/api/sites/${siteId}/pages/${pageId}`,
  );

  // Config is derived from the shared block registry once per mount.
  const config = useMemo(() => buildPuckConfig(), []);

  const page = data?.page;
  const initialData = useMemo(
    () => (page ? toPuckData(page.blocks ?? []) : null),
    [page],
  );

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlePublish = useCallback(
    async (puckData: Parameters<typeof fromPuckData>[0]) => {
      setSaving(true);
      setSaveError(null);
      try {
        const blocks = fromPuckData(puckData);
        await apiFetch(`/api/sites/${siteId}/pages/${pageId}`, {
          method: "POST",
          body: { blocks, seo: page?.seo ?? {}, source: "editor" },
        });
        setSavedAt(new Date().toISOString());
      } catch (err) {
        setSaveError(
          err instanceof ApiError ? err.message : "Couldn’t save this page. Try again.",
        );
      } finally {
        setSaving(false);
      }
    },
    [siteId, pageId, page],
  );

  if (loading) return <CenteredSpinner label="Loading page…" />;
  if (error) return <ErrorCard message={`Couldn’t load this page: ${error}`} />;
  if (!page || !initialData) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Link to={`/sites/${slug}`} className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Back to {slug}
          </Link>
          <h1 className="text-lg font-semibold">{page.title}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {saving && (
            <span className="flex items-center gap-1 text-zinc-500">
              <Spinner /> Saving…
            </span>
          )}
          {!saving && saveError && <span className="text-red-600">{saveError}</span>}
          {!saving && !saveError && savedAt && (
            <span className="text-green-600">Saved ✓</span>
          )}
          <a
            href={`${liveSiteUrl(slug)}/${page.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            View live ↗
          </a>
        </div>
      </div>

      <Puck config={config} data={initialData} onPublish={handlePublish} />
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Spinner /> {label}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="pt-5 text-sm text-red-600">{message}</CardContent>
    </Card>
  );
}
