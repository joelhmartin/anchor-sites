import { useEffect, useMemo, useRef, useState } from "react";
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
import { TemplateCover } from "../components/TemplateCover.js";
import {
  TemplateDetailDialog,
  type TemplatePageRef,
} from "../components/TemplateDetailDialog.js";
import { TemplatePreviewOverlay } from "../components/TemplatePreviewOverlay.js";

/**
 * Lovable-style new-site screen (Task B4; W1.1 remediation, 2026-07-30
 * product-audit): a big "What do you want to build?" prompt above a template
 * gallery, with an actual review-before-choose flow.
 *
 * The W1.1 redesign (operator-verified defect: clicking a template card only
 * painted a border and silently armed a small "Create site" pill one viewport
 * above, off-screen):
 *
 * - Card click SELECTS the template and opens `TemplateDetailDialog` (cover,
 *   description, page manifest via `GET /api/templates/:id`) with "Use this
 *   template" / "Preview" CTAs; a per-card "Use" button is the no-dialog fast
 *   path (D200, D205).
 * - "Preview" opens `TemplatePreviewOverlay` — a full-screen sandboxed render
 *   of the template's own pages (D701).
 * - Selection arms a FIXED bottom action bar that echoes the selection
 *   ("«Starter» selected") and carries the primary create CTA — visible at
 *   any scroll position (D200/D201/D202).
 * - Selection is one source-of-truth enum (`"blank" | "template:<id>" |
 *   null`) actually consumed by `handleSubmit` (D204); "Start blank" with no
 *   prompt auto-opens Details and focuses the name input (D203).
 * - Create honesty: a synchronous in-flight guard (D207); the from-template
 *   response's `job.queued` is read and a false surfaces an error with a
 *   re-enqueue Retry (D208/D703); a template-only create navigates to the
 *   workspace IMMEDIATELY and the workspace shows a "materializing" state
 *   driven by pages actually appearing (D213); a slug 409 opens Details and
 *   focuses the slug field (D209).
 * - Compose (template + prompt) never races materialization: pages must land
 *   before the agent conversation starts, and the seed message tells the
 *   agent the template was already applied (D1107). On a poll timeout it
 *   does NOT start the agent — the operator gets an explicit "Open
 *   workspace" affordance instead.
 * - Gallery hygiene: loading skeletons / error-with-retry / true-empty
 *   states (D210), a category filter row with counts (D222/D715),
 *   `aria-pressed` selection (D211), labelled prompt textarea (D212),
 *   pages-count on cards (D714/D205), compose-mode subcopy (D220), and a
 *   Details echo that reads as information (D219).
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const POLL_MS = 700;
/** Compose only: how long to wait for materialization before refusing to
 * start the agent (D1107). Template-only creates don't wait at all (D213). */
const COMPOSE_POLL_TIMEOUT_MS = 30_000;

type TemplateOption = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  cover_image_url?: string | null;
  pages_count?: number;
};

/** D204 — the single source of truth `handleSubmit` consumes. */
type Selection = "blank" | `template:${string}` | null;

type EnqueueFailure = {
  siteId: string;
  templateId: string;
  siteSlug: string;
  templateName: string;
  pagesCount?: number;
  message: string;
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

/** D1107 — the compose seed message must state the template is already on the
 * site, so the agent adapts it instead of building from scratch. */
export function composeSeedMessage(templateName: string, prompt: string): string {
  return `The template "${templateName}" was already applied to this site — adapt and extend it rather than starting from scratch.\n\n${prompt}`;
}

export function NewSitePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Review-before-choose surfaces.
  const [detailTemplate, setDetailTemplate] = useState<TemplateOption | null>(null);
  const [preview, setPreview] = useState<{ template: TemplateOption; pages: TemplatePageRef[] } | null>(null);

  // D208/D703 — a created site whose materialize enqueue failed.
  const [enqueueFailure, setEnqueueFailure] = useState<EnqueueFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  // D1107 — compose materialization didn't land in time; don't start the agent.
  const [slowSite, setSlowSite] = useState<{ slug: string; templateName: string; pagesCount?: number } | null>(null);

  // D207 — synchronous double-submit guard (React state is too late).
  const inFlightRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const slugInputRef = useRef<HTMLInputElement | null>(null);
  const barCreateRef = useRef<HTMLButtonElement | null>(null);
  const [pendingFocus, setPendingFocus] = useState<"name" | "slug" | "createBar" | null>(null);

  useEffect(() => {
    if (!pendingFocus) return;
    const el =
      pendingFocus === "name"
        ? nameInputRef.current
        : pendingFocus === "slug"
          ? slugInputRef.current
          : barCreateRef.current;
    el?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const {
    data: templatesData,
    loading: templatesLoading,
    error: templatesError,
    reload: reloadTemplates,
  } = useApi<{ templates: TemplateOption[] }>("/api/templates?kind=site");
  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData]);

  // D222/D715 — category filter row (with counts), "All" default. Categories
  // keep gallery order (sort_order asc via the API).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      const c = t.category ?? "Other";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [templates]);
  const visibleTemplates = categoryFilter
    ? templates.filter((t) => (t.category ?? "Other") === categoryFilter)
    : templates;

  const hasPrompt = prompt.trim().length > 0;
  const selectedTemplateId = selection?.startsWith("template:") ? selection.slice("template:".length) : null;
  const blankSelected = selection === "blank";
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
      ? "Applying template…"
      : "Creating…"
    : hasPrompt
      ? "Build with AI"
      : selectedTemplate
        ? `Create from ${selectedTemplate.name}`
        : "Create site";

  // D202 — a disabled primary action says why.
  const disabledReason = busy
    ? null
    : !formValid
      ? blankSelected || selectedTemplate
        ? "Add a name in Details to continue"
        : "Describe the site, pick a template, or start blank"
      : null;

  function handleConflict(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setError(`The slug "${effectiveSlug}" is already in use. Pick another.`);
      // D209 — reveal and focus the field the error names.
      setDetailsOpen(true);
      setPendingFocus("slug");
    } else {
      setError(err instanceof Error ? err.message : "Couldn't create the site.");
    }
  }

  /** Poll site detail until materialization created at least one page.
   * Returns true when pages landed, false on timeout (caller decides). */
  async function waitForPages(siteId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const d = await apiFetch<{ site: { pages_count: number } }>(`/api/sites/${siteId}`);
        if (d.site.pages_count > 0) return true;
      } catch {
        // transient — keep polling until the deadline
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  /** The workspace URL that shows the "materializing pages…" state (D213). */
  function workspaceMaterializingUrl(slug: string, templateName: string, pagesCount?: number): string {
    const params = new URLSearchParams();
    params.set("materializing", String(pagesCount && pagesCount > 0 ? pagesCount : 1));
    params.set("template", templateName);
    return `/sites/${slug}?${params.toString()}`;
  }

  async function startConversationAndNavigate(siteId: string, slug: string, message: string) {
    try {
      await apiFetch(`/api/sites/${siteId}/agent/conversations`, {
        method: "POST",
        body: { title: "Initial build", message, run: "job" },
      });
      navigate(`/sites/${slug}?ai=1`);
    } catch {
      navigate(`/sites/${slug}?ai=1&ai_error=1`);
    }
  }

  /** Shared by first submit and the D208 retry once the job is queued. */
  async function proceedAfterQueued(input: {
    siteId: string;
    siteSlug: string;
    templateName: string;
    pagesCount?: number;
    trimmedPrompt: string;
  }) {
    const { siteId, siteSlug, templateName, pagesCount, trimmedPrompt } = input;
    if (!trimmedPrompt) {
      // D213 — navigate immediately; the workspace renders the materializing
      // state driven by pages actually appearing.
      navigate(workspaceMaterializingUrl(siteSlug, templateName, pagesCount));
      return;
    }
    // Compose: the agent must not race materialization (D1107).
    setMaterializing(true);
    const landed = await waitForPages(siteId, COMPOSE_POLL_TIMEOUT_MS);
    setMaterializing(false);
    if (!landed) {
      setSlowSite({ slug: siteSlug, templateName, pagesCount });
      setError(
        `"${templateName}" is taking longer than expected to apply. The site was created — you can open it and start the AI once its pages are in.`,
      );
      return;
    }
    await startConversationAndNavigate(siteId, siteSlug, composeSeedMessage(templateName, trimmedPrompt));
  }

  async function handleSubmit() {
    // D207 — synchronous guard: two clicks in one render can't double-POST.
    if (inFlightRef.current || !canSubmit) return;
    inFlightRef.current = true;
    const trimmedPrompt = prompt.trim();
    setBusy(true);
    setError(null);
    setSlowSite(null);
    try {
      if (selectedTemplateId && selectedTemplate) {
        const res = await apiFetch<{
          site: { id: string };
          job?: { queued: boolean; error?: string };
        }>("/api/sites/from-template", {
          method: "POST",
          body: { slug: effectiveSlug, display_name: effectiveName.trim(), template_id: selectedTemplateId },
        });
        // D208 — the server reports enqueue failure; don't narrate success.
        if (res.job && res.job.queued === false) {
          setEnqueueFailure({
            siteId: res.site.id,
            templateId: selectedTemplateId,
            siteSlug: effectiveSlug,
            templateName: selectedTemplate.name,
            pagesCount: selectedTemplate.pages_count,
            message: res.job.error ?? "the page-creation job could not be queued",
          });
          return;
        }
        await proceedAfterQueued({
          siteId: res.site.id,
          siteSlug: effectiveSlug,
          templateName: selectedTemplate.name,
          pagesCount: selectedTemplate.pages_count,
          trimmedPrompt,
        });
      } else {
        // Blank (explicit or implicit) / AI-only path — `selection` is the
        // consumed source of truth (D204). W1.5 / D1100: the default brand
        // tokens are sent EVEN when a prompt will run the agent afterwards —
        // previously a prompt-only build shipped with no theme at all unless
        // the model volunteered set_brand_tokens, so a from-scratch site
        // rendered unthemed. The tokens are a baseline the agent's own
        // set_brand_tokens call (step 4 of its system prompt) replaces.
        const body: Record<string, unknown> = { slug: effectiveSlug, display_name: effectiveName.trim() };
        body.default_brand_tokens = DEFAULT_BRAND_TOKENS;
        const site = await apiFetch<{ site?: { id: string }; id?: string }>("/api/sites", {
          method: "POST",
          body,
        });
        const siteId = site.site?.id ?? site.id;
        if (!siteId) throw new Error("Site created, but no id was returned.");
        if (trimmedPrompt) {
          await startConversationAndNavigate(siteId, effectiveSlug, trimmedPrompt);
        } else {
          navigate(`/sites/${effectiveSlug}`);
        }
      }
    } catch (err) {
      handleConflict(err);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      setMaterializing(false);
    }
  }

  /** D208 — re-enqueue the failed materialization, then proceed normally. */
  async function retryMaterialize() {
    if (!enqueueFailure || retrying) return;
    setRetrying(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${enqueueFailure.siteId}/materialize-template`, {
        method: "POST",
        body: { template_id: enqueueFailure.templateId },
      });
      const failure = enqueueFailure;
      setEnqueueFailure(null);
      await proceedAfterQueued({
        siteId: failure.siteId,
        siteSlug: failure.siteSlug,
        templateName: failure.templateName,
        pagesCount: failure.pagesCount,
        trimmedPrompt: prompt.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  /** Card click — select AND open the detail dialog (D200/D205). */
  function openTemplate(t: TemplateOption) {
    setSelection(`template:${t.id}`);
    setDetailTemplate(t);
  }

  /** "Use" fast path / dialog CTA — select, close surfaces, focus the bar. */
  function armTemplate(t: TemplateOption) {
    setSelection(`template:${t.id}`);
    setDetailTemplate(null);
    setPreview(null);
    setPendingFocus("createBar");
  }

  function pickBlank() {
    setSelection("blank");
    // D203 — blank with nothing to derive a name from is a dead end unless
    // the operator finds the hidden Details row; open it and focus the name.
    if (!hasPrompt && !nameTouched) {
      setDetailsOpen(true);
      setPendingFocus("name");
    }
  }

  function clearSelection() {
    setSelection(null);
  }

  const actionBarVisible = selection !== null || enqueueFailure !== null;

  return (
    <div className={cn("mx-auto flex max-w-4xl flex-col gap-16 px-6 py-16", actionBarVisible && "pb-36")}>
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-zinc-900">
          What do you want to build?
        </h1>
        <p className="max-w-xl text-[15px] text-zinc-500">
          Describe the site — the pages, the audience, the tone — and the agent builds it. Or pick a
          template below and make it yours.
        </p>

        <div className="w-full max-w-2xl">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-12px_rgba(0,0,0,0.12)] transition focus-within:border-zinc-300">
            <textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the site you want to build…"
              aria-label="Describe the site to build"
              className="w-full resize-none bg-transparent text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDetailsOpen((o) => !o)}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-600"
              >
                {detailsOpen ? "Hide details" : "Details"}
                {/* D219 — echo only once there is real information to echo. */}
                {effectiveName ? (
                  <span className="ml-2 text-zinc-300">
                    {effectiveName} · {effectiveSlug || "no slug yet"}
                  </span>
                ) : null}
              </button>
              <Button variant="dark" className="rounded-full px-5" onClick={handleSubmit} disabled={!canSubmit}>
                {busy ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> {primaryLabel}
                  </span>
                ) : (
                  primaryLabel
                )}
              </Button>
            </div>
            {disabledReason && !actionBarVisible && (
              <p className="mt-2 text-right text-xs text-zinc-400">{disabledReason}</p>
            )}
          </div>

          {detailsOpen && (
            <Card className="mt-3 text-left">
              <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input
                    id="display_name"
                    ref={nameInputRef}
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
                    ref={slugInputRef}
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
          {slowSite && (
            <div className="mt-2 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(workspaceMaterializingUrl(slowSite.slug, slowSite.templateName, slowSite.pagesCount))
                }
              >
                Open workspace
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-zinc-900">Start from a template</h2>
          {/* D220 — the marquee combination is stated in the UI, not a comment. */}
          <p className="text-sm text-zinc-500">
            Pick one to review its pages — add a prompt above and the agent will customize it for you.
          </p>
        </div>

        {/* D222/D715 — category filter with counts; "All" default. */}
        {!templatesLoading && !templatesError && categories.length > 1 && (
          <div role="group" aria-label="Filter by category" className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={categoryFilter === null}
              onClick={() => setCategoryFilter(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                categoryFilter === null
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              All ({templates.length})
            </button>
            {categories.map(([cat, count]) => (
              <button
                key={cat}
                type="button"
                aria-pressed={categoryFilter === cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  categoryFilter === cat
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {cat} ({count})
              </button>
            ))}
          </div>
        )}

        {/* D210 — loading / error / true-empty are all distinct states. */}
        {templatesLoading ? (
          <div data-testid="template-skeletons" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
                <div className="h-40 w-full bg-zinc-100" />
                <div className="flex flex-col gap-2 p-4">
                  <div className="h-4 w-1/2 rounded bg-zinc-100" />
                  <div className="h-3 w-3/4 rounded bg-zinc-100" />
                </div>
              </div>
            ))}
          </div>
        ) : templatesError ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm text-red-600">Couldn't load templates: {templatesError}</p>
            <Button variant="outline" size="sm" onClick={reloadTemplates}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {templates.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 p-4 text-sm text-zinc-500 sm:col-span-2 lg:col-span-2">
                No templates yet — start blank, or describe the site above and let the agent build it.
              </div>
            )}
            {visibleTemplates.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-lg border bg-white transition duration-150 hover:-translate-y-0.5 hover:shadow-lg",
                  selectedTemplateId === t.id ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200",
                )}
              >
                <button
                  type="button"
                  aria-pressed={selectedTemplateId === t.id}
                  onClick={() => openTemplate(t)}
                  className="flex flex-col text-left focus-visible:outline-none"
                >
                  <div className="overflow-hidden">
                    <TemplateCover name={t.name} coverImageUrl={t.cover_image_url} />
                  </div>
                  <div className="flex w-full flex-col gap-2 p-4 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900">{t.name}</span>
                      {t.category && <Badge tone="neutral">{t.category}</Badge>}
                    </div>
                    {t.description && <p className="line-clamp-2 text-sm text-zinc-500">{t.description}</p>}
                  </div>
                </button>
                <div className="mt-auto flex items-center justify-between px-4 pb-3 pt-1">
                  {/* D714/D205 — the fetched pages_count finally reaches eyes. */}
                  <span className="text-xs text-zinc-400">
                    {typeof t.pages_count === "number"
                      ? `${t.pages_count} ${t.pages_count === 1 ? "page" : "pages"}`
                      : ""}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Use ${t.name}`}
                    onClick={() => armTemplate(t)}
                  >
                    Use
                  </Button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={pickBlank}
              aria-pressed={blankSelected}
              className={cn(
                "group flex flex-col overflow-hidden rounded-lg border border-dashed bg-zinc-50/60 text-left transition duration-150 hover:-translate-y-0.5 hover:shadow-lg",
                blankSelected ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-300",
              )}
            >
              <div className="flex h-40 w-full items-center justify-center text-3xl font-light text-zinc-300 transition-transform duration-200 group-hover:scale-[1.04]">
                +
              </div>
              <div className="flex flex-col gap-2 p-4">
                <span className="font-medium text-zinc-900">Start blank</span>
                <p className="text-sm text-zinc-500">An empty site you'll build page by page.</p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Review-before-choose surfaces (W1.1). */}
      {detailTemplate && (
        <TemplateDetailDialog
          template={detailTemplate}
          open
          onOpenChange={(open) => {
            if (!open) setDetailTemplate(null);
          }}
          onUse={() => armTemplate(detailTemplate)}
          onPreview={(pages) => {
            setPreview({ template: detailTemplate, pages });
            setDetailTemplate(null);
          }}
        />
      )}
      {preview && (
        <TemplatePreviewOverlay
          template={preview.template}
          pages={preview.pages}
          onUse={() => armTemplate(preview.template)}
          onClose={() => setPreview(null)}
        />
      )}

      {/* D200/D201/D202 — the armed state lives in a FIXED bottom action bar,
          visible at any scroll position. left-56 clears the admin sidebar. */}
      {actionBarVisible && (
        <div
          data-testid="new-site-action-bar"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur sm:left-56"
        >
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            {enqueueFailure ? (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    "{enqueueFailure.templateName}" site created, but its pages failed to queue.
                  </p>
                  <p className="truncate text-xs text-red-600">{enqueueFailure.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate(
                        workspaceMaterializingUrl(
                          enqueueFailure.siteSlug,
                          enqueueFailure.templateName,
                          enqueueFailure.pagesCount,
                        ),
                      )
                    }
                  >
                    Open workspace
                  </Button>
                  <Button variant="dark" size="sm" className="rounded-full px-4" disabled={retrying} onClick={retryMaterialize}>
                    {retrying ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {selectedTemplate ? (
                      <>“{selectedTemplate.name}” selected</>
                    ) : blankSelected ? (
                      <>Start blank selected</>
                    ) : null}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {disabledReason
                      ? disabledReason
                      : selectedTemplate && hasPrompt
                        ? `Creates the template's pages, then the agent applies your prompt to them.`
                        : selectedTemplate
                          ? `Creates ${
                              typeof selectedTemplate.pages_count === "number" && selectedTemplate.pages_count > 0
                                ? `${selectedTemplate.pages_count} ${selectedTemplate.pages_count === 1 ? "page" : "pages"}`
                                : "its pages"
                            } as ${effectiveName || "a new site"} — add a prompt to customize it with AI.`
                          : `An empty site named ${effectiveName || "…"} — add a prompt to build it with AI.`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={clearSelection} disabled={busy}>
                    Clear
                  </Button>
                  <Button
                    ref={barCreateRef}
                    variant="dark"
                    size="sm"
                    className="rounded-full px-5"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    title={disabledReason ?? undefined}
                  >
                    {busy ? (
                      <span className="flex items-center gap-2">
                        <Spinner /> {primaryLabel}
                      </span>
                    ) : (
                      primaryLabel
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
