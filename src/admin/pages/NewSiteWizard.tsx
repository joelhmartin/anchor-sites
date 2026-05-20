import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { BrandTokenFields, DEFAULT_BRAND_TOKENS } from "../components/BrandTokenFields.js";

/**
 * New-site wizard (P4-T4.11). Two steps: (1) slug + display name with live
 * slug validation, (2) brand-token color pairs with a live preview. Submits
 * `POST /api/sites`; on success routes to the new site's detail page.
 *
 * Slug regex mirrors the server payload schema (admin-sites.ts) so the
 * client gates the same shape the API enforces.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function NewSiteWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [tokens, setTokens] = useState<Record<string, string>>({ ...DEFAULT_BRAND_TOKENS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(slug);
  const step1Valid = displayName.trim().length > 0 && slugValid;

  function setToken(key: string, value: string) {
    setTokens((t) => ({ ...t, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!step1Valid) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/sites", {
        method: "POST",
        body: {
          slug,
          display_name: displayName.trim(),
          default_brand_tokens: tokens,
        },
      });
      navigate(`/sites/${slug}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`The slug “${slug}” is already in use. Go back and pick another.`);
      } else {
        setError(err instanceof Error ? err.message : "Couldn’t create the site.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New site</h1>
        <span className="text-sm text-zinc-500">Step {step} of 2</span>
      </div>

      <Card className="max-w-2xl">
        {/* Admin chrome, not a CRM embed — the no-<form> anchor is about CRM/editor surfaces. */}
        <form onSubmit={submit}>
          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle>Name &amp; slug</CardTitle>
                <p className="text-sm text-zinc-500">
                  The slug becomes the site’s subdomain and can’t be changed later.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input
                    id="display_name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Muldoon Dental"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="muldoon-dental"
                    aria-invalid={slug.length > 0 && !slugValid}
                  />
                  {slug.length > 0 && !slugValid ? (
                    <p className="text-xs text-red-600">
                      Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400">{slug || "slug"}.sites.anchorcorps.com</p>
                  )}
                </div>
              </CardContent>
              <div className="flex justify-end gap-2 px-6 pb-6">
                <Button variant="outline" onClick={() => navigate("/")}>
                  Cancel
                </Button>
                <Button onClick={() => setStep(2)} disabled={!step1Valid}>
                  Next
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle>Brand colors</CardTitle>
                <p className="text-sm text-zinc-500">
                  Pick the site’s core colors. You can change these any time in Settings.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <BrandTokenFields
                  tokens={tokens}
                  onChange={setToken}
                  previewLabel={displayName || "Your site"}
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
              </CardContent>
              <div className="flex items-center justify-between px-6 pb-6">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setTokens({ ...DEFAULT_BRAND_TOKENS })}
                >
                  Reset to defaults
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Spinner /> : "Create site"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </form>
      </Card>
    </div>
  );
}
