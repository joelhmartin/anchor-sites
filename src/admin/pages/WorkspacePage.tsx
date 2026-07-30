import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import type { AgentChangeEvent, AiConversation } from "../lib/agent-api.js";
import type { SiteDetail, SiteListRow } from "../lib/siteTypes.js";
import { useAgentConversation } from "../components/agent-chat/useAgentConversation.js";
import { ChatTranscript } from "../components/agent-chat/ChatTranscript.js";
import { Composer } from "../components/agent-chat/Composer.js";
import { EmptyState } from "../components/agent-chat/EmptyState.js";
import { SitePreviewPanel } from "../components/SitePreviewPanel.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";

type PageOption = { id: string; slug: string; title: string; status: string };

/** Mirrors `src/server/git/state-repo.ts`'s `SiteGitState`, the same shape
 * `GitCard` reads (`site-tabs/GitCard.tsx`). */
type SiteGitState = { enabled: boolean };
type GitStatus = { configured: boolean; repo: string | null; state: SiteGitState | null };

type Viewport = "desktop" | "mobile";

/**
 * Lovable-style workspace shell (Task B2, 2026-07-30 lovable-workspace SDD):
 * "rip off Lovable pretty much exactly, but for websites" — a full-screen,
 * two-pane layout with the Studio chat on the left and the live site
 * preview on the right. This is now the primary landing surface for a site
 * (`/sites/:slug`); the tab-based management shell (pages/blog/media/
 * settings/…) moved to `/sites/:slug/manage`.
 *
 * The URL routes by slug, but the detail/pages/git endpoints key off the
 * site UUID, so slug → id is resolved from the already-cheap `GET
 * /api/sites` list first, mirroring `SiteDetailPage`.
 */
export function WorkspacePage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) {
    return (
      <div className="flex h-full items-center gap-2 p-8 text-sm text-zinc-500">
        <Spinner /> Loading site…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn't load sites: {error}</CardContent>
        </Card>
      </div>
    );
  }

  const row = data?.sites.find((s) => s.slug === slug);
  if (!row) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-5">
            <p className="text-sm text-zinc-600">No site found for "{slug}".</p>
            <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              ← Back to sites
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <WorkspaceView siteId={row.id} slug={row.slug} />;
}

function WorkspaceView({ siteId, slug }: { siteId: string; slug: string }) {
  const { data: siteData } = useApi<{ site: SiteDetail }>(`/api/sites/${siteId}`);
  const site = siteData?.site;

  const [searchParams] = useSearchParams();
  // `?ai=1` (new-site "Start with AI" hand-off) auto-focuses the composer —
  // the workspace itself IS the landing surface now, so there's no drawer
  // to auto-open; `?ai_error=1` explains an empty transcript when the
  // initial-build conversation/job POST failed after the site was created
  // (NewSiteWizard.tsx).
  const aiFocus = searchParams.get("ai") === "1";
  const aiError = searchParams.get("ai_error") === "1";
  // `?page=<id>` (B5 — PagesTab "preview" deep link) preselects a page.
  const initialPageParam = searchParams.get("page");

  const [previewPageId, setPreviewPageId] = useState<string | null>(initialPageParam);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [agentBusy, setAgentBusy] = useState(false);
  const [viewport, setViewport] = useState<Viewport>("desktop");

  // Task B3 — one-click publish. `publishOpen` drives the confirmation
  // popover anchored under the top-bar button; `publishResult` swaps that
  // same popover's content to the success state (live URL) once the POST
  // resolves, so there's no separate success surface to wire up.
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ published: number; live_url: string | null } | null>(
    null,
  );
  const [publishError, setPublishError] = useState<string | null>(null);
  // Fix round 1 (Critical finding 1): outside-click/Escape close + initial
  // focus need refs into the popover's DOM — the toggle button (so an
  // outside-click handler doesn't treat clicking it as "outside" and race
  // its own onClick toggle) and the popover panel itself, plus the two
  // buttons that get focus depending on which state (confirm vs success)
  // is showing.
  const publishButtonRef = useRef<HTMLButtonElement | null>(null);
  const publishPopoverRef = useRef<HTMLDivElement | null>(null);
  const publishConfirmRef = useRef<HTMLButtonElement | null>(null);
  const publishDoneRef = useRef<HTMLButtonElement | null>(null);

  const {
    data: pagesData,
    error: pagesError,
    reload: reloadPages,
  } = useApi<{ pages: PageOption[] }>(`/api/sites/${siteId}/pages`);
  const pages = pagesData?.pages ?? [];
  // Fix round 1 (Critical finding 1): the server only publishes pages whose
  // status isn't already 'published' (POST /publish) — the confirmation
  // must count the SAME set, not every page on the site, or an already-
  // partially-published site shows a wrong "Publish N pages?" count.
  const draftPageCount = pages.filter((p) => p.status !== "published").length;

  // Default the page switcher to "home" (by slug) or the first page, once
  // the pages list has loaded and nothing else (an explicit `?page=` or an
  // agent change event) has already picked one.
  useEffect(() => {
    if (previewPageId || pages.length === 0) return;
    const home = pages.find((p) => p.slug === "home") ?? pages[0];
    setPreviewPageId(home.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const { data: gitData } = useApi<GitStatus>(`/api/sites/${siteId}/git`);
  const gitUrl =
    gitData?.configured && gitData.state?.enabled && gitData.repo
      ? `https://github.com/${gitData.repo}/tree/main/sites/${slug}`
      : null;

  function handleChangeEvent(c: AgentChangeEvent) {
    if (c.page_id) setPreviewPageId(c.page_id);
    setPreviewNonce((n) => n + 1);
  }

  function handleStatusChange(_status: AiConversation["status"] | null, busy: boolean) {
    setAgentBusy(busy);
  }

  // Fix round 1 (Important finding 1 — reviewer): a tailed change (e.g. the
  // agent's `create_page` tool call) can add/remove/rename a page, which
  // the top-bar page `<select>` has no way to know about unless the pages
  // list itself refetches. `handleChangeEvent` above already bumps the
  // preview nonce for the SAME event via `onChangeEvent`, so this is
  // reload-only — bumping the nonce again here would just double-increment
  // it for no benefit.
  function handlePagesMaybeChanged() {
    reloadPages();
  }

  // The revert path (`ChangeCard`'s "Revert" button, via `ChatTranscript`'s
  // `onSiteChanged` prop) isn't a tailed event `handleChangeEvent` already
  // covers — it needs its own nonce bump to refresh the iframe, alongside
  // the same pages-list reload (a reverted page could reappear/disappear
  // from the switcher too).
  function handleRevertSiteChanged() {
    reloadPages();
    setPreviewNonce((n) => n + 1);
  }

  // Task B3 — publish every draft page in one call. The confirmation
  // popover is opened by the button's onClick; this only fires once the
  // operator confirms.
  async function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await apiFetch<{ published: number; live_url: string | null }>(
        `/api/sites/${siteId}/publish`,
        { method: "POST" },
      );
      setPublishResult(result);
      reloadPages();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "publish failed");
    } finally {
      setPublishing(false);
    }
  }

  // Fix round 1 (Important finding 2 — a11y): the popover is `role="dialog"`
  // but was rendered with none of the behavior that implies — Escape and an
  // outside click now both close it, mirroring what Radix's Dialog gives
  // for free (kept as a hand-rolled anchored popover rather than switching
  // to that full-screen-overlay primitive, since this is meant to hang off
  // the button, not take over the screen).
  useEffect(() => {
    if (!publishOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPublishOpen(false);
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (publishPopoverRef.current?.contains(target)) return;
      if (publishButtonRef.current?.contains(target)) return;
      setPublishOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [publishOpen]);

  // Initial focus: the Confirm button when the popover opens (or reopens
  // after Cancel/Done reset publishResult), and the Done button once a
  // result has landed — imperative refs rather than the `autofocus`
  // attribute since that's only reliably applied by browsers on elements
  // present at initial parse, not ones mounted later by React.
  useEffect(() => {
    if (!publishOpen) return;
    if (publishResult) publishDoneRef.current?.focus();
    else publishConfirmRef.current?.focus();
  }, [publishOpen, publishResult]);

  const { items, draft, setDraft, sending, busy, conversation, error, usageText, send, stop } = useAgentConversation({
    siteId,
    active: true,
    // The workspace is the permanent home for this conversation (not a
    // toggleable drawer) — reconnect to an already-running/erroring turn
    // on load, e.g. after a refresh mid-build.
    autoTail: true,
    onSiteChanged: handlePagesMaybeChanged,
    onChangeEvent: handleChangeEvent,
    onStatusChange: handleStatusChange,
  });

  // Autoscroll pin (mirrors AgentChatDrawer): only follow new content when
  // the user was already near the bottom.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  function handleTranscriptScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  // `?ai=1` auto-focuses the composer (replaces the drawer's auto-open —
  // the chat panel is always visible here, there's nothing to "open").
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!aiFocus) return;
    const textarea = chatPanelRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message"]',
    );
    textarea?.focus();
  }, [aiFocus]);

  const showEmptyState = items.length === 0;

  return (
    <div className="grid h-full grid-cols-[380px_1fr] bg-zinc-50">
      <div ref={chatPanelRef} className="flex h-full min-w-0 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Studio chat</h2>
        </div>

        {aiError && (
          <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            The site was created, but the initial AI build couldn't be started automatically. Send a
            message below to kick it off.
          </p>
        )}

        {showEmptyState && <EmptyState onPreset={(preset) => send(preset)} />}

        <ChatTranscript
          items={items}
          busy={busy}
          siteId={siteId}
          slug={slug}
          onSiteChanged={handleRevertSiteChanged}
          scrollRef={scrollContainerRef}
          onScroll={handleTranscriptScroll}
        />

        {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => send()}
          onStop={stop}
          sending={sending}
          resumeVisible={conversation?.status === "error"}
          onResume={() => send("continue")}
          usageText={usageText}
        />
      </div>

      <div className="flex h-full min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-sm font-semibold text-zinc-900">{site?.display_name ?? slug}</h1>
          </div>

          <div className="flex items-center gap-2">
            {pagesError ? (
              // Minor finding (reviewer): mirror the same red error
              // treatment the sites list uses instead of the switcher just
              // silently disappearing.
              <span className="text-xs text-red-600">Couldn't load pages: {pagesError}</span>
            ) : (
              pages.length > 0 && (
                <select
                  aria-label="Page"
                  value={previewPageId ?? ""}
                  onChange={(e) => setPreviewPageId(e.target.value)}
                  className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs"
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )
            )}

            <div role="group" aria-label="Viewport" className="flex overflow-hidden rounded-md border border-zinc-300">
              <button
                type="button"
                aria-pressed={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium",
                  viewport === "desktop" ? "bg-indigo-50 text-indigo-700" : "bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                Desktop
              </button>
              <button
                type="button"
                aria-pressed={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
                className={cn(
                  "border-l border-zinc-300 px-2.5 py-1 text-xs font-medium",
                  viewport === "mobile" ? "bg-indigo-50 text-indigo-700" : "bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                Mobile
              </button>
            </div>

            {/* Task B3 — one-click publish. `publishOpen` anchors a small
                confirmation popover under the button; disabled while the
                agent is running (a mid-build publish would ship a half-
                finished site), while the publish request itself is in
                flight, or when there's nothing to publish (Fix round 1,
                Critical finding 1). */}
            <div className="relative">
              <Button
                ref={publishButtonRef}
                type="button"
                size="sm"
                disabled={agentBusy || publishing || draftPageCount === 0}
                title={
                  agentBusy
                    ? "Agent is running"
                    : draftPageCount === 0
                      ? "Nothing to publish"
                      : undefined
                }
                onClick={() => {
                  setPublishError(null);
                  setPublishResult(null);
                  setPublishOpen((open) => !open);
                }}
              >
                {publishing ? "Publishing…" : "Publish"}
              </Button>

              {publishOpen && (
                <div
                  ref={publishPopoverRef}
                  role="dialog"
                  aria-label="Publish site"
                  className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-zinc-200 bg-white p-3 shadow-lg"
                >
                  {publishResult ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-zinc-700">
                        Published {publishResult.published}{" "}
                        {publishResult.published === 1 ? "page" : "pages"}.
                      </p>
                      {publishResult.live_url && (
                        <a
                          href={publishResult.live_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          {publishResult.live_url} ↗
                        </a>
                      )}
                      <div className="flex justify-end">
                        <Button
                          ref={publishDoneRef}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPublishOpen(false)}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-zinc-700">
                        {draftPageCount > 0
                          ? `Publish ${draftPageCount} ${draftPageCount === 1 ? "page" : "pages"}?`
                          : "Everything is published."}
                      </p>
                      {publishError && <p className="text-xs text-red-600">{publishError}</p>}
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={publishing}
                          onClick={() => setPublishOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          ref={publishConfirmRef}
                          type="button"
                          size="sm"
                          disabled={publishing || agentBusy || draftPageCount === 0}
                          onClick={handlePublish}
                        >
                          {publishing ? "Publishing…" : "Confirm"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {gitUrl && (
              <a
                href={gitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                GitHub ↗
              </a>
            )}

            <Link
              to={`/sites/${slug}/manage`}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              Manage
            </Link>
          </div>
        </div>

        <div className="flex flex-1 items-start justify-center overflow-auto bg-zinc-100 p-6">
          <div
            data-testid="workspace-preview-frame"
            className={cn(viewport === "mobile" ? "w-[390px]" : "w-full")}
          >
            <SitePreviewPanel
              siteId={siteId}
              previewPageId={previewPageId}
              previewNonce={previewNonce}
              agentBusy={agentBusy}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
