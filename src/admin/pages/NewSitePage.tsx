import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import { DEFAULT_BRAND_TOKENS } from "../components/BrandTokenFields.js";

/**
 * Lovable-style new-site screen (Task B4, 2026-07-30 lovable-workspace SDD):
 * replaces the old two-step `NewSiteWizard` with a single screen — a big
 * "What do you want to build?" prompt above a template gallery ("rip off
 * Lovable's feel": cover image, name, one-line description, category chip).
 *
 * All three of the old wizard's create paths are preserved (blank, template,
 * AI), plus one new combination the old wizard couldn't express — a template
 * pick *and* a prompt together ("compose"): the site materializes from the
 * template first, then an agent conversation runs the prompt against it, the
 * same way the pure-AI path does. Whichever path ends up starting a
 * conversation lands on the workspace (`?ai=1`); a path with no prompt lands
 * on the tab-based management shell (`/manage`), matching the site having no
 * running build to watch.
 *
 * Slug/display-name auto-derive from the first line of the prompt (if any)
 * or the picked template's name, and stay editable in a collapsed "Details"
 * row — same slug rules as the old wizard (`SLUG_RE` below).
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const POLL_MS = 700;
const POLL_TIMEOUT_MS = 8000;

type TemplateOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  cover_image_url?: string | null;
  pages_count?: number;
};

function firstLineOf(text: string): string {
  return text.split("\n")[0]!.trim().slice(0, 80);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

/** Deterministic hue from a string so the same template always gets the same
 * placeholder gradient across renders/reloads. */
function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Cover image, or (every current template, until Phase C) a tasteful
 * branded placeholder block using the template's initials. */
function TemplateCover({ name, coverImageUrl }: { name: string; coverImageUrl?: string | null }) {
  if (coverImageUrl) {
    return <img src={coverImageUrl} alt="" className="h-36 w-full object-cover" />;
  }
  const hue = hashHue(name);
  return (
    <div
      className="flex h-36 w-full items-center justify-center text-2xl font-semibold text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 70% 32%))`,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

export function NewSitePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [blankSelected, setBlankSelected] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: templatesData } = useApi<{ templates: TemplateOption[] }>("/api/templates?kind=site");
  const templates = templatesData?.templates ?? [];

  const hasPrompt = prompt.trim().length > 0;
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const autoName = hasPrompt ? firstLineOf(prompt) : selectedTemplate ? selectedTemplate.name : "";
  const effectiveName = nameTouched ? nameInput : autoName;
  const autoSlug = slugify(effectiveName);
  const effectiveSlug = slugTouched ? slugInput : autoSlug;

  const slugValid = effectiveSlug.length === 0 ? false : SLUG_RE.test(effectiveSlug);
  const formValid = effectiveName.trim().length > 0 && slugValid;
  const canSubmit = formValid && !busy;

  const primaryLabel = busy
    ? materializing
      ? "Creating pages…"
      : "Creating…"
    : hasPrompt
      ? "Build with AI"
      : "Create site";

  function handleConflict(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setError(`The slug "${effectiveSlug}" is already in use. Pick another.`);
    } else {
      setError(err instanceof Error ? err.message : "Couldn't create the site.");
    }
  }

  // Poll site detail until the materialization job has created at least one
  // page, so the operator lands on a populated Pages tab. Bounded; proceeds
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

  // Shared by every path that ends up with a prompt to run: create the
  // job-run conversation, then land on the workspace with the Studio drawer
  // focused. A conversation-create failure must not strand the operator —
  // the site is already real, so navigate anyway with `ai_error=1` (mirrors
  // the old wizard's AI-branch bot-review fix, item 8).
  async function startConversationAndNavigate(siteId: string, message: string) {
    try {
      await apiFetch(`/api/sites/${siteId}/agent/conversations`, {
        method: "POST",
        body: { title: "Initial build", message, run: "job" },
      });
      navigate(`/sites/${effectiveSlug}?ai=1`);
    } catch {
      navigate(`/sites/${effectiveSlug}?ai=1&ai_error=1`);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const trimmedPrompt = prompt.trim();
    setBusy(true);
    setError(null);
    try {
      if (selectedTemplateId) {
        const res = await apiFetch<{ site: { id: string } }>("/api/sites/from-template", {
          method: "POST",
          body: { slug: effectiveSlug, display_name: effectiveName.trim(), template_id: selectedTemplateId },
        });
        setMaterializing(true);
        await waitForPages(res.site.id);
        setMaterializing(false);
        if (trimmedPrompt) {
          await startConversationAndNavigate(res.site.id, trimmedPrompt);
        } else {
          navigate(`/sites/${effectiveSlug}/manage`);
        }
      } else {
        const body: Record<string, unknown> = { slug: effectiveSlug, display_name: effectiveName.trim() };
        if (!trimmedPrompt) body.default_brand_tokens = DEFAULT_BRAND_TOKENS;
        const site = await apiFetch<{ site?: { id: string }; id?: string }>("/api/sites", {
          method: "POST",
          body,
        });
        const siteId = site.site?.id ?? site.id;
        if (!siteId) throw new Error("Site created, but no id was returned.");
        if (trimmedPrompt) {
          await startConversationAndNavigate(siteId, trimmedPrompt);
        } else {
          navigate(`/sites/${effectiveSlug}/manage`);
        }
      }
    } catch (err) {
      handleConflict(err);
    } finally {
      setBusy(false);
      setMaterializing(false);
    }
  }

  function pickTemplate(t: TemplateOption) {
    setSelectedTemplateId(t.id);
    setBlankSelected(false);
  }

  function pickBlank() {
    setSelectedTemplateId(null);
    setBlankSelected(true);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-10">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">What do you want to build?</h1>
        <p className="max-w-xl text-sm text-zinc-500">
          Describe the site — the pages, the audience, the tone — and the agent builds it. Or pick a
          template below and make it yours.
        </p>

        <div className="w-full max-w-2xl">
          <textarea
            autoFocus
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the site you want to build…"
            className="w-full resize-none rounded-xl border border-zinc-300 bg-white p-4 text-base text-zinc-900 shadow-sm placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
            >
              {detailsOpen ? "Hide details" : "Details"}
              <span className="ml-2 text-zinc-400">
                {effectiveName || "Untitled site"} · {effectiveSlug || "—"}
              </span>
            </button>
            <Button size="lg" onClick={handleSubmit} disabled={!canSubmit}>
              {busy ? (
                <span className="flex items-center gap-2">
                  <Spinner /> {primaryLabel}
                </span>
              ) : (
                primaryLabel
              )}
            </Button>
          </div>

          {detailsOpen && (
            <Card className="mt-3 text-left">
              <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input
                    id="display_name"
                    value={effectiveName}
                    onChange={(e) => {
                      setNameTouched(true);
                      setNameInput(e.target.value);
                    }}
                    placeholder="Muldoon Dental"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={effectiveSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlugInput(e.target.value);
                    }}
                    placeholder="muldoon-dental"
                    aria-invalid={effectiveSlug.length > 0 && !slugValid}
                  />
                  {effectiveSlug.length > 0 && !slugValid ? (
                    <p className="text-xs text-red-600">
                      Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400">{effectiveSlug || "slug"}.sites.anchorcorps.com</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold text-zinc-900">Or start from a template</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pickTemplate(t)}
              className={cn(
                "flex flex-col overflow-hidden rounded-lg border text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                selectedTemplateId === t.id
                  ? "border-indigo-500 ring-2 ring-indigo-200"
                  : "border-zinc-200 bg-white",
              )}
            >
              <TemplateCover name={t.name} coverImageUrl={t.cover_image_url} />
              <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900">{t.name}</span>
                  {t.category && <Badge tone="info">{t.category}</Badge>}
                </div>
                {t.description && <p className="line-clamp-2 text-sm text-zinc-500">{t.description}</p>}
              </div>
            </button>
          ))}

          <button
            type="button"
            onClick={pickBlank}
            className={cn(
              "flex flex-col overflow-hidden rounded-lg border border-dashed text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
              blankSelected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-zinc-300 bg-zinc-50",
            )}
          >
            <div className="flex h-36 w-full items-center justify-center text-3xl font-light text-zinc-300">+</div>
            <div className="flex flex-col gap-2 p-4">
              <span className="font-medium text-zinc-900">Start blank</span>
              <p className="text-sm text-zinc-500">An empty site you'll build page by page.</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
