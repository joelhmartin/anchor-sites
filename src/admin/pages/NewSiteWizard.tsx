import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import { BrandTokenFields, DEFAULT_BRAND_TOKENS } from "../components/BrandTokenFields.js";

/**
 * New-site wizard (P4-T4.11, extended P7-T7.8). Step 1 takes name + slug and a
 * "Start from" choice: a blank site or one of the site templates (P7). A blank
 * site continues to step 2 (brand colors) and submits `POST /api/sites`. A
 * template skips the color step (the template carries brand tokens, D-042) and
 * submits `POST /api/sites/from-template`, then polls the new site's detail
 * until materialized pages appear before routing to it.
 *
 * Slug regex mirrors the server payload schema (admin-sites.ts).
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const POLL_MS = 700;
const POLL_TIMEOUT_MS = 8000;

type TemplateOption = { id: string; name: string; pages_count: number };

export function NewSiteWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [tokens, setTokens] = useState<Record<string, string>>({ ...DEFAULT_BRAND_TOKENS });
  const [busy, setBusy] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: templatesData } = useApi<{ templates: TemplateOption[] }>("/api/templates?kind=site");
  const templates = templatesData?.templates ?? [];

  const slugValid = SLUG_RE.test(slug);
  const step1Valid = displayName.trim().length > 0 && slugValid;
  const usingTemplate = templateId !== "";

  function setToken(key: string, value: string) {
    setTokens((t) => ({ ...t, [key]: value }));
  }

  function handleConflict(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setError(`The slug “${slug}” is already in use. Pick another.`);
    } else {
      setError(err instanceof Error ? err.message : "Couldn’t create the site.");
    }
  }

  // Blank site → POST /api/sites (existing flow).
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!step1Valid) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/sites", {
        method: "POST",
        body: { slug, display_name: displayName.trim(), default_brand_tokens: tokens },
      });
      navigate(`/sites/${slug}`);
    } catch (err) {
      handleConflict(err);
    } finally {
      setBusy(false);
    }
  }

  // Poll site detail until the materialization job has created at least one
  // page, so the operator lands on a populated Pages tab. Bounded; navigates
  // anyway on timeout (the site exists regardless).
  async function waitForPages(siteId: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      try {
        const d = await apiFetch<{ site: { pages_count: number } }>(`/api/sites/${siteId}`);
        if (d.site.pages_count > 0) return;
      } catch {
        // transient — keep polling until the deadline
      }
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  // Template → POST /api/sites/from-template, then wait for materialization.
  async function submitFromTemplate() {
    if (!step1Valid || !usingTemplate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ site: { id: string } }>("/api/sites/from-template", {
        method: "POST",
        body: { slug, display_name: displayName.trim(), template_id: templateId },
      });
      setMaterializing(true);
      await waitForPages(res.site.id);
      navigate(`/sites/${slug}`);
    } catch (err) {
      handleConflict(err);
    } finally {
      setBusy(false);
      setMaterializing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New site</h1>
        <span className="text-sm text-zinc-500">{usingTemplate ? "From template" : `Step ${step} of 2`}</span>
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
                <div className="flex flex-col gap-1">
                  <Label htmlFor="start_from">Start from</Label>
                  <select
                    id="start_from"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  >
                    <option value="">Blank site</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.pages_count} {t.pages_count === 1 ? "page" : "pages"})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-400">
                    {usingTemplate
                      ? "Pages and brand colors come from the template — you can edit them after."
                      : "An empty site you’ll build page by page."}
                  </p>
                </div>
                {usingTemplate && error && <p className="text-sm text-red-600">{error}</p>}
              </CardContent>
              <div className="flex justify-end gap-2 px-6 pb-6">
                <Button type="button" variant="outline" onClick={() => navigate("/")}>
                  Cancel
                </Button>
                {usingTemplate ? (
                  <Button type="button" onClick={submitFromTemplate} disabled={!step1Valid || busy}>
                    {busy ? (
                      <span className="flex items-center gap-2">
                        <Spinner /> {materializing ? "Creating pages…" : "Creating…"}
                      </span>
                    ) : (
                      "Create from template"
                    )}
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setStep(2)} disabled={!step1Valid}>
                    Next
                  </Button>
                )}
              </div>
            </>
          )}

          {step === 2 && !usingTemplate && (
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
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
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
