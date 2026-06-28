import { useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import type { SiteDetail } from "../../lib/siteTypes.js";
import type { SiteSeoDefaults } from "../../../server/seo/schema.js";
import { ImagePicker } from "../../../editor/custom-fields/image-field.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";

/**
 * Site-level SEO defaults tab (P9-T9.8, D-049). Edits `sites.seo_defaults`
 * (title template, default meta description, default og:image, twitter handle)
 * — applied UNDER per-page SEO by the renderer (9.3). Saves via
 * `PATCH /api/sites/:siteId { seo_defaults }`.
 */
export function SeoSettingsTab({ site }: { site: SiteDetail }) {
  const initial = (site.seo_defaults ?? {}) as SiteSeoDefaults;
  const [titleTemplate, setTitleTemplate] = useState(initial.titleTemplate ?? "");
  const [defaultDescription, setDefaultDescription] = useState(initial.defaultDescription ?? "");
  const [ogImage, setOgImage] = useState(initial.defaultOgImageAssetId ?? "");
  const [twitterHandle, setTwitterHandle] = useState(initial.twitterHandle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    titleTemplate !== (initial.titleTemplate ?? "") ||
    defaultDescription !== (initial.defaultDescription ?? "") ||
    ogImage !== (initial.defaultOgImageAssetId ?? "") ||
    twitterHandle !== (initial.twitterHandle ?? "");

  const change = (setter: (v: string) => void) => (v: string) => {
    setSaved(false);
    setter(v);
  };

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const seo_defaults: SiteSeoDefaults = {};
    if (titleTemplate.trim()) seo_defaults.titleTemplate = titleTemplate.trim();
    if (defaultDescription.trim()) seo_defaults.defaultDescription = defaultDescription.trim();
    if (ogImage) seo_defaults.defaultOgImageAssetId = ogImage;
    if (twitterHandle.trim()) seo_defaults.twitterHandle = twitterHandle.trim();
    try {
      await apiFetch(`/api/sites/${site.id}`, { method: "PATCH", body: { seo_defaults } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save SEO defaults.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="seo-title-template">Title template</Label>
            <Input
              id="seo-title-template"
              value={titleTemplate}
              onChange={(e) => change(setTitleTemplate)(e.target.value)}
              placeholder="%s — Acme Dental"
            />
            <p className="text-xs text-zinc-400">
              <code>%s</code> is replaced with each page’s title. Leave blank for no template.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="seo-default-description">Default meta description</Label>
            <textarea
              id="seo-default-description"
              className="w-full rounded border border-zinc-200 p-2 text-sm"
              rows={2}
              maxLength={320}
              value={defaultDescription}
              onChange={(e) => change(setDefaultDescription)(e.target.value)}
              placeholder="Used when a page has no description of its own"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="seo-twitter">Twitter handle</Label>
            <Input
              id="seo-twitter"
              value={twitterHandle}
              onChange={(e) => change(setTwitterHandle)(e.target.value)}
              placeholder="@acmedental"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label>Default share image</Label>
            <ImagePicker siteId={site.id} value={ogImage} onChange={change(setOgImage)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!dirty || busy}>
              {busy ? <Spinner /> : "Save changes"}
            </Button>
            {saved && <span className="text-sm text-green-600">Saved.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
