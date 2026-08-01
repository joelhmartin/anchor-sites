import { useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.js";
import { Spinner } from "../../ui/spinner.js";

/** Mirrors src/server/git/state-repo.ts's SiteGitState (server-side source of truth). */
type SiteGitState = {
  site_id: string;
  enabled: boolean;
  last_export_sha: string | null;
  last_import_sha: string | null;
  last_synced_at: string | null;
  /** @deprecated D616 — legacy shared slot; read the per-direction ones below. */
  last_error: string | null;
  last_export_error: string | null;
  last_import_error: string | null;
  updated_at: string;
};

type GitStatus = {
  configured: boolean;
  repo: string | null;
  state: SiteGitState | null;
  /** D317 — server-built canonical deep link; optional for older servers. */
  url?: string | null;
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/**
 * GitHub sync card (GitHub Sync plan, Task 7). Rendered in SettingsTab below
 * the existing site-settings cards. Reads `GET /api/sites/:siteId/git`;
 * when the server isn't configured for git sync at all (no
 * GITHUB_CONTENT_TOKEN/REPO), shows a muted note and nothing else — there's
 * no enable toggle to offer since exports/imports can never run. Once
 * configured, offers an enable/disable toggle (`POST .../git/enable`) and a
 * manual "Export now" trigger (`POST .../git/export`, only meaningful —
 * and only enabled — once sync is turned on for this site).
 */
export function GitCard({
  siteId,
  slug,
  // D415: bounded post-export poll window. Defaults are production-sized;
  // tests inject small values so the poll resolves instantly.
  exportPollIntervalMs = 2000,
  exportPollMaxTries = 8,
}: {
  siteId: string;
  slug: string;
  exportPollIntervalMs?: number;
  exportPollMaxTries?: number;
}) {
  const { data, loading, error, reload } = useApi<GitStatus>(`/api/sites/${siteId}/git`);
  // D435 — per-action busy state: the single shared `busy` flag spinnered the
  // Enable button while an export ran, conflating two independent actions.
  const [toggleBusy, setToggleBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  // D435 — enabling sync ALSO enqueues an initial full export (admin-git.ts);
  // announce that outcome so the operator knows a commit is about to land.
  const [enableNotice, setEnableNotice] = useState<string | null>(null);

  async function toggleEnabled(next: boolean) {
    setToggleBusy(true);
    setActionError(null);
    setEnableNotice(null);
    try {
      await apiFetch(`/api/sites/${siteId}/git/enable`, { method: "POST", body: { enabled: next } });
      // D435 — surface the enable side effect (an initial export is queued).
      if (next) setEnableNotice("Sync enabled — a first export to the repo was queued.");
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update GitHub sync.");
    } finally {
      setToggleBusy(false);
    }
  }

  async function exportNow() {
    setExportBusy(true);
    setActionError(null);
    setExportStatus(null);
    try {
      await apiFetch(`/api/sites/${siteId}/git/export`, { method: "POST", body: {} });
      // D415: the export runs asynchronously in a job — a bare reload() here
      // races the worker and re-renders the PRE-export state. Show "Export
      // queued…" and poll the git endpoint for a bounded window until the
      // job's OUTCOME lands (export sha advances or an export error appears),
      // so the card reflects what actually happened.
      setExportStatus("Export queued…");
      const before = data?.state?.last_export_sha ?? null;
      for (let i = 0; i < exportPollMaxTries; i++) {
        await new Promise((r) => setTimeout(r, exportPollIntervalMs));
        const fresh = await apiFetch<GitStatus>(`/api/sites/${siteId}/git`).catch(() => null);
        if (
          fresh?.state &&
          (fresh.state.last_export_sha !== before || fresh.state.last_export_error)
        ) {
          break;
        }
      }
      setExportStatus(null);
      reload();
    } catch (err) {
      setExportStatus(null);
      setActionError(err instanceof Error ? err.message : "Couldn't export.");
    } finally {
      setExportBusy(false);
    }
  }

  // D416/D603: re-drive the site's most recent import (the one a transient
  // GitHub blip likely dead-lettered). The server re-enqueues the last import
  // payload; the handler is idempotent, so this is safe to click repeatedly.
  async function reimportNow() {
    setImportBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/git/import`, { method: "POST", body: {} });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't re-run import.");
    } finally {
      setImportBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-5 text-sm text-zinc-500">
          <Spinner /> Loading GitHub sync…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm text-red-600">
          Couldn't load GitHub sync: {error}
        </CardContent>
      </Card>
    );
  }

  if (!data.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>GitHub sync</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-zinc-500">
          GitHub sync isn't configured — see docs/github-sync.md
        </CardContent>
      </Card>
    );
  }

  const state = data.state;
  const enabled = state?.enabled ?? false;
  // D317 — prefer the server's canonical URL (branch via HEAD + export path
  // derived server-side); fall back to the hardcoded derivation only for an
  // older server that doesn't return `url`.
  const repoUrl = data.repo
    ? (data.url ?? `https://github.com/${data.repo}/tree/main/sites/${slug}`)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          GitHub sync
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "enabled" : "disabled"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-indigo-600 hover:underline"
          >
            {data.repo}
          </a>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={enabled ? "outline" : "primary"}
            disabled={toggleBusy}
            onClick={() => toggleEnabled(!enabled)}
          >
            {toggleBusy ? <Spinner /> : enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" disabled={exportBusy || !enabled} onClick={exportNow}>
            {exportBusy ? <Spinner /> : "Export now"}
          </Button>
        </div>
        {/* D435 — announce the enable side effect at the button. */}
        {!enabled && (
          <p className="text-xs text-zinc-400">Enabling also runs a first export to the repo.</p>
        )}
        {enableNotice && <p className="text-sm text-green-600">{enableNotice}</p>}

        <div className="flex flex-col gap-1 text-sm text-zinc-600">
          {/*
           * Fix round 2 (Minor): `last_synced_at` is bumped by BOTH
           * recordExport and recordImport (state-repo.ts), so it isn't
           * specifically an export timestamp — the old copy read "Exported
           * <sha> · <time>" even when that relative time came from the most
           * recent IMPORT. Label the timestamp on its own honest line and
           * keep the export/import sha lines free of a time that isn't
           * necessarily theirs.
           */}
          {(state?.last_synced_at || state?.updated_at) && (
            <p>Last synced {relativeTime(state.last_synced_at ?? state.updated_at)}</p>
          )}
          {state?.last_export_sha && <p>Exported {shortSha(state.last_export_sha)}</p>}
          {state?.last_import_sha && <p>Imported {shortSha(state.last_import_sha)}</p>}
          {/*
           * D616/D415: each pipeline's failure gets its OWN labeled line —
           * a successful export no longer erases an unresolved import error
           * (they're separate columns now), and the label + timestamp tell
           * the operator WHICH direction failed and WHEN, instead of a bare
           * red string that could have come from either pipeline.
           */}
          {state?.last_export_error && (
            <p className="text-red-600">
              Export failed{state.updated_at ? ` (${relativeTime(state.updated_at)})` : ""}: {state.last_export_error}
            </p>
          )}
          {state?.last_import_error && (
            <div className="flex flex-col gap-1">
              <p className="text-red-600">
                Import failed{state.updated_at ? ` (${relativeTime(state.updated_at)})` : ""}: {state.last_import_error}
              </p>
              {/* D416/D603: manual re-drive of the last import for this site. */}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={importBusy}
                onClick={reimportNow}
              >
                {importBusy ? <Spinner /> : "Re-run import"}
              </Button>
            </div>
          )}
        </div>

        {exportStatus && <p className="text-sm text-zinc-500">{exportStatus}</p>}
        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      </CardContent>
    </Card>
  );
}
