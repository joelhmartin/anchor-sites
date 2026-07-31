import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Github, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import type { AgentChangeEvent, AiConversation } from "../lib/agent-api.js";
import type { SiteDetail, SiteListRow } from "../lib/siteTypes.js";
import { useAgentConversation } from "../components/agent-chat/useAgentConversation.js";
import { ChatTranscript } from "../components/agent-chat/ChatTranscript.js";
import { Composer } from "../components/agent-chat/Composer.js";
import { EmptyState } from "../components/agent-chat/EmptyState.js";
import { SitePreviewPanel } from "../components/SitePreviewPanel.js";
import { StudioWordmark } from "../components/StudioWordmark.js";
import { UserMenu } from "../components/UserMenu.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";

type PageOption = {
  id: string;
  slug: string;
  title: string;
  status: string;
  /**
   * D301 — server-computed: drafts OR published pages whose working copy
   * diverged from the published snapshot. Optional so an older/mocked
   * response degrades to the status-only count.
   */
  has_unpublished_changes?: boolean;
};

/** Mirrors `src/server/git/state-repo.ts`'s `SiteGitState`, the same shape
 * `GitCard` reads (`site-tabs/GitCard.tsx`). */
type SiteGitState = { enabled: boolean };
type GitStatus = { configured: boolean; repo: string | null; state: SiteGitState | null };

type Viewport = "desktop" | "mobile";

// Task B6 (2026-07-30 lovable-workspace SDD) — resizable chat rail (mid-task
// operator addition): a hand-rolled pointer-capture drag on a splitter
// between the chat rail and the preview column, persisted so a chosen width
// survives reloads. No new dependency — plain pointerdown/move/up, the same
// shape as a native `<input type="range">`'s drag but for a pane width.
const CHAT_WIDTH_STORAGE_KEY = "ac.workspace.chatWidth";
const DEFAULT_CHAT_WIDTH = 400;
const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 640;
const CHAT_WIDTH_STEP = 16;

function clampChatWidth(width: number): number {
  return Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, width));
}

function readStoredChatWidth(): number {
  try {
    const raw = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? clampChatWidth(parsed) : DEFAULT_CHAT_WIDTH;
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
}

function persistChatWidth(width: number): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Private-browsing/storage-disabled shouldn't break resizing — the width
    // just won't survive a reload.
  }
}

/**
 * Lovable-style workspace shell (Task B2, 2026-07-30 lovable-workspace SDD;
 * Task B6 gave it its Lovable-grade visual pass): "rip off Lovable pretty
 * much exactly, but for websites" — a full-screen, two-pane layout with the
 * Studio chat on the left and the live site preview on the right. This is
 * now the primary landing surface for a site (`/sites/:slug`); the tab-based
 * management shell (pages/blog/media/settings/…) lives at `/sites/:slug/manage`.
 *
 * The URL routes by slug, but the detail/pages/git endpoints key off the
 * site UUID, so slug → id is resolved from the already-cheap `GET
 * /api/sites` list first, mirroring `SiteDetailPage`.
 *
 * Task B6 screenshot-driven follow-up: this route is mounted as a SIBLING of
 * `<AdminLayout>` in `AdminApp.tsx`, not a child — it owns the full viewport
 * itself (`h-screen`), with no admin sidebar. The wordmark/nav/sign-out that
 * sidebar used to provide now live in this page's own chrome (`StudioWordmark`
 * atop the chat rail, `UserMenu` at the end of the top bar).
 */
export function WorkspacePage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) {
    return (
      <div className="flex h-screen items-center gap-2 bg-[#F7F7F8] p-8 text-sm text-zinc-500">
        <Spinner /> Loading site…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-screen bg-[#F7F7F8] p-8">
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn't load sites: {error}</CardContent>
        </Card>
      </div>
    );
  }

  const row = data?.sites.find((s) => s.slug === slug);
  if (!row) {
    return (
      <div className="h-screen bg-[#F7F7F8] p-8">
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
  // W1.1 / D213 — a from-template create navigates here IMMEDIATELY (no
  // blind client-side wait on NewSitePage); `?materializing=<n>&template=…`
  // tells this page to show a "materializing pages" state driven by pages
  // actually appearing, polling the pages list until they do.
  const materializingParam = searchParams.get("materializing");
  const materializeTemplateName = searchParams.get("template");
  const expectedPageCount = materializingParam ? Number(materializingParam) || 0 : 0;

  const [previewPageId, setPreviewPageId] = useState<string | null>(initialPageParam);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [agentBusy, setAgentBusy] = useState(false);
  const [viewport, setViewport] = useState<Viewport>("desktop");

  // Task B6 — resizable chat rail.
  const [chatWidth, setChatWidth] = useState<number>(() => readStoredChatWidth());
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function handleSplitterPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Older browsers/test environments without pointer capture — the
        // drag still works via the plain pointermove handler below.
      }
    }
    document.body.style.userSelect = "none";
  }

  function handleSplitterPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setChatWidth(clampChatWidth(e.clientX - rect.left));
  }

  function endSplitterDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
    }
    document.body.style.userSelect = "";
    persistChatWidth(chatWidthRef.current);
  }

  function handleSplitterDoubleClick() {
    setChatWidth(DEFAULT_CHAT_WIDTH);
    persistChatWidth(DEFAULT_CHAT_WIDTH);
  }

  function handleSplitterKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = clampChatWidth(chatWidth - CHAT_WIDTH_STEP);
    else if (e.key === "ArrowRight") next = clampChatWidth(chatWidth + CHAT_WIDTH_STEP);
    else if (e.key === "Home") next = MIN_CHAT_WIDTH;
    else if (e.key === "End") next = MAX_CHAT_WIDTH;
    if (next === null) return;
    e.preventDefault();
    setChatWidth(next);
    persistChatWidth(next);
  }

  // Task B3 — one-click publish. `publishOpen` drives the confirmation
  // popover anchored under the top-bar button; `publishResult` swaps that
  // same popover's content to the success state (live URL) once the POST
  // resolves, so there's no separate success surface to wire up.
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // `live_url_ready` (final review item 2b) is the primary domain's
  // verification_status==='verified' && ssl_status==='active' — i.e. whether
  // the `site.provision` job has finished mapping the hostname on Cloud Run
  // and getting its cert. Optional in the type only so an older/mocked
  // response shape stays non-fatal; absent is treated as "not ready", which
  // is the safe direction (a note instead of a possibly-dead link).
  const [publishResult, setPublishResult] = useState<{
    published: number;
    live_url: string | null;
    live_url_ready?: boolean;
    live_url_status?: { verification_status?: string; ssl_status?: string };
    /** D611 — null: sync off; queued:false carries the enqueue error. */
    git_export?: { queued: boolean; error?: string } | null;
  } | null>(null);
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
  // Fix round 1 (Critical finding 1) + D301: the server publishes pages
  // with UNPUBLISHED CHANGES (drafts + published pages edited since their
  // last publish — POST /publish's WHERE uses the same predicate) — the
  // confirmation must count the SAME set, or the pill says "Nothing to
  // publish" while edits sit unshipped (the exact D301 lie). Falls back to
  // the status-only count for an older/mocked payload.
  const draftPageCount = pages.filter(
    (p) => p.has_unpublished_changes ?? p.status !== "published",
  ).length;

  // Default the page switcher to "home" (by slug) or the first page, once
  // the pages list has loaded and nothing else (an explicit `?page=` or an
  // agent change event) has already picked one.
  useEffect(() => {
    if (previewPageId || pages.length === 0) return;
    const home = pages.find((p) => p.slug === "home") ?? pages[0];
    setPreviewPageId(home.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  // W1.1 / D213 — while the create hand-off says pages are materializing and
  // none have appeared yet, poll the pages list; the banner (and this
  // polling) retire themselves the moment pages exist. `pagesData` (not
  // `pages.length`) gates so the very first fetch settling with 0 pages
  // still counts as "none yet" rather than "not loaded".
  const materializing = materializingParam !== null && pagesData !== null && pages.length === 0;
  useEffect(() => {
    if (!materializing) return;
    const timer = setInterval(() => reloadPages(), 1200);
    return () => clearInterval(timer);
  }, [materializing, reloadPages]);

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
      const result = await apiFetch<{
        published: number;
        live_url: string | null;
        live_url_ready?: boolean;
        git_export?: { queued: boolean; error?: string } | null;
      }>(`/api/sites/${siteId}/publish`, { method: "POST" });
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

  const {
    items, draft, setDraft, sending, busy, reconnecting, conversation, error, usageText, send, stop,
  } = useAgentConversation({
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
    <div
      ref={containerRef}
      className="grid h-screen bg-[#F7F7F8]"
      style={{ gridTemplateColumns: `${chatWidth}px 6px 1fr` }}
    >
      <div ref={chatPanelRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
        {/* Task B6 — the wordmark replaces AdminLayout's sidebar (now
            skipped entirely for this route) as the way back to the sites
            list, and takes the place of the old "Studio chat" label. */}
        <div className="shrink-0 px-4 pb-2 pt-4">
          <StudioWordmark className="text-sm" />
        </div>

        {aiError && (
          <p className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
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

        {/* D1118 — the tail dropped repeatedly and is auto-retrying; say so
            instead of letting the build look frozen. */}
        {reconnecting && (
          <p className="shrink-0 px-4 pb-2 text-xs text-amber-600" role="status">
            Connection lost — reconnecting to the build…
          </p>
        )}
        {error && <p className="shrink-0 px-4 pb-2 text-xs text-red-600">{error}</p>}

        <div className="shrink-0">
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => send()}
            onStop={stop}
            sending={sending}
            busy={busy}
            resumeVisible={conversation?.status === "error" || conversation?.status === "stopped"}
            onResume={() => send("continue")}
            usageText={usageText}
          />
        </div>
      </div>

      {/* Task B6 — resizable-rail splitter. A thin hit area (the visible
          hairline is a 1px bar centered in it) rather than a bare 1px
          border, so it's actually grabbable. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuenow={chatWidth}
        aria-valuemin={MIN_CHAT_WIDTH}
        aria-valuemax={MAX_CHAT_WIDTH}
        tabIndex={0}
        onPointerDown={handleSplitterPointerDown}
        onPointerMove={handleSplitterPointerMove}
        onPointerUp={endSplitterDrag}
        onPointerCancel={endSplitterDrag}
        onDoubleClick={handleSplitterDoubleClick}
        onKeyDown={handleSplitterKeyDown}
        className="group relative flex h-full w-full cursor-col-resize items-stretch justify-center focus-visible:outline-none"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 transition-colors group-hover:bg-zinc-300 group-focus-visible:bg-zinc-400" />
      </div>

      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4">
          <h1 className="truncate text-sm font-medium text-zinc-900">{site?.display_name ?? slug}</h1>

          <div className="flex items-center gap-1.5">
            {gitUrl && (
              <a
                href={gitUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                title="View repository"
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                <Github className="h-4 w-4" />
              </a>
            )}

            <div role="group" aria-label="Viewport" className="flex items-center gap-0.5 rounded-md bg-zinc-100 p-0.5">
              <button
                type="button"
                aria-label="Desktop"
                aria-pressed={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded",
                  viewport === "desktop" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700",
                )}
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Mobile"
                aria-pressed={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded",
                  viewport === "mobile" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700",
                )}
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
            </div>

            <Link
              to={`/sites/${slug}/manage`}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              Manage
            </Link>

            {/* Task B3 — one-click publish. `publishOpen` anchors a small
                confirmation popover under the button; disabled while the
                agent is running (a mid-build publish would ship a half-
                finished site), while the publish request itself is in
                flight, or when there's nothing to publish (Fix round 1,
                Critical finding 1). Task B6: solid black pill, not the
                app's default indigo — no blue buttons in this shell. */}
            <div className="relative">
              <Button
                ref={publishButtonRef}
                type="button"
                variant="dark"
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
                className="rounded-full px-4 shadow-sm transition-transform hover:-translate-y-px disabled:translate-y-0 disabled:shadow-none"
              >
                {publishing ? "Publishing…" : "Publish"}
              </Button>

              {publishOpen && (
                <div
                  ref={publishPopoverRef}
                  role="dialog"
                  aria-label="Publish site"
                  className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg"
                >
                  {publishResult ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-zinc-700">
                        Published {publishResult.published}{" "}
                        {publishResult.published === 1 ? "page" : "pages"}.
                      </p>
                      {/* Final review items 2c + 3 — a site's canonical
                          hostname is provisioned asynchronously (Cloud Run
                          mapping + cert, via the `site.provision` job), so
                          for the first minutes of a new site this URL
                          resolves to nothing. Rendering it as a success-
                          styled external link the moment publish returned
                          sent the operator straight to a dead page and made
                          a working publish look broken. Only link it once
                          the server says the domain is actually ready;
                          otherwise show the same URL as plain text with a
                          note that says what's happening. */}
                      {/* D321 — no primary domain means live_url is null and
                          this success state used to render NOTHING: published
                          pages, no way to reach them, no next step. Hand the
                          operator the forward path instead. */}
                      {!publishResult.live_url && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-zinc-500">
                            No domain is connected yet, so your published pages aren’t
                            reachable.
                          </span>
                          <Link
                            to={`/sites/${slug}/manage?tab=domains`}
                            className="text-xs font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
                          >
                            Connect a domain →
                          </Link>
                        </div>
                      )}
                      {/* D611 — the export enqueue can fail without failing
                          the publish; say so instead of narrating success. */}
                      {publishResult.git_export && !publishResult.git_export.queued && (
                        <span className="text-xs text-amber-600">
                          GitHub sync couldn’t be queued
                          {publishResult.git_export.error
                            ? ` (${publishResult.git_export.error})`
                            : ""}
                          . Publishing again re-tries, or use Manage → Settings → Export
                          now.
                        </span>
                      )}
                      {publishResult.live_url &&
                        (publishResult.live_url_ready ? (
                          <a
                            href={publishResult.live_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
                          >
                            {publishResult.live_url} ↗
                          </a>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="break-all text-xs font-medium text-zinc-500">
                              {publishResult.live_url}
                            </span>
                            {publishResult.live_url_status?.verification_status === "failed" ||
                            publishResult.live_url_status?.ssl_status === "failed" ? (
                              <span className="text-xs text-red-600">
                                Domain provisioning failed — see Manage → Domains for details.
                              </span>
                            ) : (
                              <span className="text-xs text-amber-600">
                                Domain still provisioning — the link will go live shortly.
                              </span>
                            )}
                          </div>
                        ))}
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
                          variant="dark"
                          className="rounded-full px-4"
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

            <UserMenu />
          </div>
        </div>

        {/* W1.1 / D213 — honest materialization state: shown until pages
            actually appear (which also stops the poll), instead of the old
            8-second blind wait on the create screen. */}
        {materializing && (
          <div
            data-testid="materializing-banner"
            className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-5 py-2 text-xs text-zinc-600"
          >
            <Spinner />
            <span>
              {`Materializing ${
                expectedPageCount > 0
                  ? `${expectedPageCount} ${expectedPageCount === 1 ? "page" : "pages"}`
                  : "pages"
              }${materializeTemplateName ? ` from “${materializeTemplateName}”` : ""}…`}
            </span>
          </div>
        )}

        {/* Small control strip above the preview frame — current page name
            (still the switcher; a quiet bordered pill now, not a bare
            native `<select>`) and a refresh affordance. The Edit toggle
            lives on the frame's own top edge (SitePreviewPanel), styled to
            read as a continuation of this same strip. */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-0 pt-4">
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
                className="h-8 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )
          )}

          <button
            type="button"
            aria-label="Refresh preview"
            onClick={() => setPreviewNonce((n) => n + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-1 justify-center overflow-auto p-5">
          <div
            data-testid="workspace-preview-frame"
            className={cn("flex flex-col", viewport === "mobile" ? "w-[390px]" : "w-full")}
          >
            <div className="flex h-full flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-8px_rgba(0,0,0,0.12)]">
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
    </div>
  );
}
