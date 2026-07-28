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
  last_error: string | null;
  updated_at: string;
};

type GitStatus = { configured: boolean; repo: string | null; state: SiteGitState | null };

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
export function GitCard({ siteId, slug }: { siteId: string; slug: string }) {
  const { data, loading, error, reload } = useApi<GitStatus>(`/api/sites/${siteId}/git`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleEnabled(next: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/git/enable`, { method: "POST", body: { enabled: next } });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update GitHub sync.");
    } finally {
      setBusy(false);
    }
  }

  async function exportNow() {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/git/export`, { method: "POST", body: {} });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't export.");
    } finally {
      setBusy(false);
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
  const repoUrl = data.repo ? `https://github.com/${data.repo}/tree/main/sites/${slug}` : null;

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
            disabled={busy}
            onClick={() => toggleEnabled(!enabled)}
          >
            {busy ? <Spinner /> : enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !enabled} onClick={exportNow}>
            Export now
          </Button>
        </div>

        <div className="flex flex-col gap-1 text-sm text-zinc-600">
          {state?.last_export_sha && (
            <p>
              Exported {shortSha(state.last_export_sha)} ·{" "}
              {relativeTime(state.last_synced_at ?? state.updated_at)}
            </p>
          )}
          {state?.last_import_sha && <p>Imported {shortSha(state.last_import_sha)}</p>}
          {state?.last_error && <p className="text-red-600">{state.last_error}</p>}
        </div>

        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      </CardContent>
    </Card>
  );
}
