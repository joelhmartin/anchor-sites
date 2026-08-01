import { useMemo, useState, useId } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { tenantHostname } from "../../lib/siteUrl.js";
import type { SiteDetail } from "../../lib/siteTypes.js";
import { BrandTokenFields, DEFAULT_BRAND_TOKENS } from "../../components/BrandTokenFields.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";

/**
 * Settings tab (P4-T4.15). Edit display_name + brand tokens (reusing the
 * wizard's color editor, pre-filled from `default_brand_tokens` merged over
 * the defaults so the full palette is editable). Save sends only the changed
 * fields to `PATCH /api/sites/:siteId`. Hostnames are read-only here — domain
 * management is Phase 10.
 */
export function SettingsTab({ site, onSiteChanged }: { site: SiteDetail; onSiteChanged?: () => void }) {
  // Show the full palette: site values win over the defaults for any key.
  const initialTokens = useMemo(
    () => ({ ...DEFAULT_BRAND_TOKENS, ...site.default_brand_tokens }),
    [site],
  );

  const [displayName, setDisplayName] = useState(site.display_name);
  const [tokens, setTokens] = useState<Record<string, string>>(initialTokens);
  const [analyticsDisabled, setAnalyticsDisabled] = useState(site.analytics_disabled ?? false);
  const analyticsToggleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // D500/D409 — site archive (Danger zone). Deletion is deliberately withheld
  // (external GCS/CRM/domain state needs an offboarding job first); archive is
  // the operator's terminal-with-a-path-out: it drafts the live surface off
  // (resolveSite gates on status='active', so an archived site 404s) and can
  // be restored. Confirm-gated because it takes the public site down.
  const archived = site.status === "archived";
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  async function setStatus(next: "active" | "archived") {
    if (next === "archived" && !window.confirm(
      `Archive “${site.display_name}”? Its public site goes offline immediately (visitors get a 404). ` +
        `You can restore it here anytime — nothing is deleted.`,
    )) {
      return;
    }
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      await apiFetch(`/api/sites/${site.id}`, { method: "PATCH", body: { status: next } });
      onSiteChanged?.();
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : "Couldn’t update the site.");
    } finally {
      setLifecycleBusy(false);
    }
  }

  // D422 — dirty is measured against this baseline, NOT the mount-time `site`
  // prop (which the parent never refreshes). After a successful save the
  // baseline advances to what we just wrote, so Save disarms and stops
  // re-sending the same PATCH; "Saved." and an armed Save no longer contradict.
  const [baseName, setBaseName] = useState(site.display_name);
  const [baseTokens, setBaseTokens] = useState<Record<string, string>>(initialTokens);
  const [baseAnalytics, setBaseAnalytics] = useState(site.analytics_disabled ?? false);

  function setToken(key: string, value: string) {
    setSaved(false);
    setTokens((t) => ({ ...t, [key]: value }));
  }

  const nameChanged = displayName.trim() !== baseName;
  const tokensChanged = JSON.stringify(tokens) !== JSON.stringify(baseTokens);
  const analyticsChanged = analyticsDisabled !== baseAnalytics;
  const hasChanges = nameChanged || tokensChanged || analyticsChanged;
  const canSave = hasChanges && displayName.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: {
      display_name?: string;
      default_brand_tokens?: Record<string, string>;
      analytics_disabled?: boolean;
    } = {};
    if (nameChanged) body.display_name = displayName.trim();
    if (tokensChanged) body.default_brand_tokens = tokens;
    if (analyticsChanged) body.analytics_disabled = analyticsDisabled;
    try {
      await apiFetch(`/api/sites/${site.id}`, { method: "PATCH", body });
      // Advance the baseline to the saved values so Save disarms (D422).
      setBaseName(displayName.trim());
      setBaseTokens(tokens);
      setBaseAnalytics(analyticsDisabled);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="settings-display-name">Display name</Label>
            <Input
              id="settings-display-name"
              value={displayName}
              onChange={(e) => {
                setSaved(false);
                setDisplayName(e.target.value);
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id={analyticsToggleId}
              type="checkbox"
              checked={analyticsDisabled}
              onChange={(e) => {
                setSaved(false);
                setAnalyticsDisabled(e.target.checked);
              }}
              className="h-4 w-4"
            />
            <Label htmlFor={analyticsToggleId}>Disable analytics script injection for this site</Label>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Brand colors</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                setSaved(false);
                setTokens({ ...DEFAULT_BRAND_TOKENS });
              }}
            >
              Reset to defaults
            </Button>
            <BrandTokenFields tokens={tokens} onChange={setToken} previewLabel={displayName} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!canSave}>
              {busy ? <Spinner /> : "Save changes"}
            </Button>
            {saved && <span className="text-sm text-green-600">Saved.</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5">
          <Label>Hostnames</Label>
          <p className="font-mono text-sm text-zinc-700">{tenantHostname(site.slug)}</p>
          <p className="text-xs text-zinc-400">Manage all domains (add custom hostnames, provision SSL) in the <strong>Domains</strong> tab.</p>
        </CardContent>
      </Card>

      {/* D427 — call tracking (CTM) and GitHub sync moved to the Integrations
          tab, where users hunt for them. */}
      <Card>
        <CardContent className="flex flex-col gap-1 pt-5">
          <Label>Integrations</Label>
          <p className="text-xs text-zinc-400">
            Call tracking (CTM), CRM, and GitHub sync live in the{" "}
            <strong>Integrations</strong> tab.
          </p>
        </CardContent>
      </Card>

      {/* D500/D409 — Danger zone: the site's operator-reachable terminal
          state. Archive (reversible) is offered; hard delete is deliberately
          withheld until an offboarding job can clean external state. */}
      <Card className="border-red-200">
        <CardContent className="flex flex-col gap-3 pt-5">
          <Label className="text-red-700">Danger zone</Label>
          {archived ? (
            <>
              <p className="text-sm text-zinc-700">
                This site is <strong>archived</strong> — its public URL returns a 404 and it’s
                hidden from the live surface. Restore it to bring it back online.
              </p>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => setStatus("active")}
                disabled={lifecycleBusy}
              >
                {lifecycleBusy ? <Spinner /> : "Restore site"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-700">
                Archiving takes the public site <strong>offline</strong> (visitors get a 404) and
                removes it from the live surface. Nothing is deleted — you can restore it here
                anytime.
              </p>
              <Button
                type="button"
                variant="danger"
                className="self-start"
                onClick={() => setStatus("archived")}
                disabled={lifecycleBusy}
              >
                {lifecycleBusy ? <Spinner /> : "Archive site"}
              </Button>
            </>
          )}
          {lifecycleError && <p className="text-sm text-red-600">{lifecycleError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
