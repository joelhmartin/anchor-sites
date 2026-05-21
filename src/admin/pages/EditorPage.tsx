import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Puck } from "../../editor/index.js";
import type { Data } from "../../editor/index.js";
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

type Revision = { id: string; created_at: string; source: string | null; author_id: string | null };

function RevisionsPanel({
  siteId,
  pageId,
  onRestored,
}: {
  siteId: string;
  pageId: string;
  onRestored: () => void;
}) {
  const { data, loading, error, reload } = useApi<{ revisions: Revision[] }>(
    `/api/sites/${siteId}/pages/${pageId}/revisions`,
  );
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const revisions = data?.revisions ?? [];

  async function restore(id: string) {
    setRestoring(id);
    setRestoreError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/pages/${pageId}/revisions/${id}/restore`, {
        method: "POST",
      });
      reload(); // refresh the list (restore appends a new revision)
      onRestored(); // re-fetch the page → editor remounts with restored blocks
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : "Restore failed.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="rounded border border-zinc-200 p-3">
      <h3 className="mb-2 text-sm font-medium">Revision history</h3>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Spinner /> Loading revisions…
        </div>
      )}
      {error && <p className="text-xs text-red-600">Couldn’t load revisions: {error}</p>}
      {restoreError && <p className="text-xs text-red-600">{restoreError}</p>}
      {!loading && !error && revisions.length === 0 && (
        <p className="text-xs text-zinc-500">No revisions yet.</p>
      )}
      {revisions.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Revisions">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-600">
                {new Date(r.created_at).toLocaleString()}
                {r.source ? ` · ${r.source}` : ""}
              </span>
              <button
                type="button"
                onClick={() => restore(r.id)}
                disabled={restoring !== null}
                className="rounded border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-50"
              >
                {restoring === r.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type AiDiff = {
  added: { id: string; type: string }[];
  removed: { id: string; type: string }[];
  updated: { id: string; type: string }[];
  moved: { id: string; type: string; from: number; to: number }[];
  unchanged: number;
  summary: string;
};
type AiProposal = {
  mode: string;
  message: string;
  proposed_blocks: Block[];
  diff: AiDiff;
};

/** Prefer the server's detailed `message` (e.g. why a proposal was rejected). */
function aiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const b = err.body;
    if (b && typeof b === "object" && "message" in b && typeof (b as { message: unknown }).message === "string") {
      return (b as { message: string }).message;
    }
    return err.message;
  }
  return fallback;
}

/**
 * "Ask AI" panel (P6-T6.6 / D-040). Sends an NL instruction to the ai-edit
 * endpoint, shows the proposed change (message + diff summary), and on Apply
 * saves the proposed `Block[]` through the EXISTING save endpoint with
 * `source:"ai"` — then `onApplied()` reloads the page so the editor remounts
 * with the applied blocks (the 5.x reload path). Does NOT import Puck (D-017):
 * it produces `Block[]`; the editor re-renders.
 */
function AskAiPanel({
  siteId,
  pageId,
  seo,
  onApplied,
}: {
  siteId: string;
  pageId: string;
  seo: Record<string, unknown>;
  onApplied: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!instruction.trim()) return;
    setAsking(true);
    setError(null);
    setProposal(null);
    try {
      const res = await apiFetch<AiProposal>(`/api/sites/${siteId}/pages/${pageId}/ai-edit`, {
        method: "POST",
        body: { instruction },
      });
      setProposal(res);
    } catch (err) {
      setError(aiErrorMessage(err, "AI request failed."));
    } finally {
      setAsking(false);
    }
  }

  async function apply() {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/pages/${pageId}`, {
        method: "POST",
        body: { blocks: proposal.proposed_blocks, seo, source: "ai" },
      });
      setProposal(null);
      setInstruction("");
      onApplied(); // reload → editor remounts with the applied blocks
    } catch (err) {
      setError(aiErrorMessage(err, "Couldn’t apply the change."));
      setApplying(false); // on success the panel unmounts via reload; only reset on error
    }
  }

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Ask AI">
      <h3 className="mb-2 text-sm font-medium">Ask AI</h3>
      <textarea
        aria-label="AI instruction"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="e.g. Make the hero punchier, or add a testimonial section"
        rows={2}
        className="w-full rounded border border-zinc-200 p-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={ask}
          disabled={asking || applying || !instruction.trim()}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {asking ? "Asking…" : "Propose"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {proposal && (
        <div className="mt-3 rounded border border-zinc-200 bg-white p-3" aria-label="AI proposal">
          <p className="text-sm text-zinc-700">{proposal.message}</p>
          <p className="mt-1 text-xs font-medium text-zinc-600">
            Proposed changes: {proposal.diff.summary}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={applying}
              className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply"}
            </button>
            <button
              type="button"
              onClick={() => setProposal(null)}
              disabled={applying}
              className="rounded border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditorView({ siteId, slug }: { siteId: string; slug: string }) {
  const { pageId } = useParams();
  const { data, loading, error, reload } = useApi<{ page: PageDetail }>(
    `/api/sites/${siteId}/pages/${pageId}`,
  );
  const [showRevisions, setShowRevisions] = useState(false);
  const [showAskAi, setShowAskAi] = useState(false);

  // Config is derived from the shared block registry; siteId lets the media
  // picker custom field fetch this site's library.
  const config = useMemo(() => buildPuckConfig({ siteId }), [siteId]);

  const page = data?.page;
  const initialData = useMemo(
    () => (page ? toPuckData(page.blocks ?? []) : null),
    [page],
  );

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  // Latest Puck data (updated on every edit) so toggling status saves current
  // edits, not just the loaded blocks.
  const liveData = useRef<Data | null>(null);

  const togglePublish = useCallback(async () => {
    if (!page || !initialData) return;
    const current = statusOverride ?? page.status;
    const next = current === "published" ? "draft" : "published";
    setSaving(true);
    setSaveError(null);
    try {
      const blocks = fromPuckData(liveData.current ?? initialData);
      const res = await apiFetch<{ page: { status: string } }>(
        `/api/sites/${siteId}/pages/${pageId}`,
        { method: "POST", body: { blocks, seo: page.seo ?? {}, status: next, source: "editor" } },
      );
      setStatusOverride(res.page.status);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn’t update status.");
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, pageId, page, initialData, statusOverride]);

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

  const currentStatus = statusOverride ?? page.status;
  const published = currentStatus === "published";

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
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {currentStatus}
          </span>
          <button
            type="button"
            onClick={togglePublish}
            disabled={saving}
            className="font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {published ? "Move to draft" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => setShowAskAi((v) => !v)}
            aria-pressed={showAskAi}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Ask AI
          </button>
          <button
            type="button"
            onClick={() => setShowRevisions((v) => !v)}
            aria-pressed={showRevisions}
            className="font-medium text-zinc-600 hover:text-zinc-800"
          >
            History
          </button>
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

      {showAskAi && pageId && (
        <AskAiPanel siteId={siteId} pageId={pageId} seo={page.seo ?? {}} onApplied={reload} />
      )}

      {showRevisions && pageId && (
        <RevisionsPanel siteId={siteId} pageId={pageId} onRestored={reload} />
      )}

      <Puck
        config={config}
        data={initialData}
        onChange={(d) => {
          liveData.current = d;
        }}
        onPublish={handlePublish}
      />
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
