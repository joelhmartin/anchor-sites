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
export function SettingsTab({ site }: { site: SiteDetail }) {
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
    </div>
  );
}
