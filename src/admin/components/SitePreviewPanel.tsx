import { useEffect, useRef, useState } from "react";
import { useApi } from "../lib/useApi.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { getAdminToken } from "../lib/adminToken.js";
import { isSessionExpired } from "../lib/sessionExpiry.js";
import { cn } from "../ui/cn.js";
import { Spinner } from "../ui/spinner.js";
import { createInlineEditor, type InlineEditorHandle } from "../lib/inline-editor.js";
import { ImagePickerDialog } from "./ImagePickerDialog.js";
import type { PickedImage } from "./image-sources.js";
import { LinkPopover } from "./LinkPopover.js";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const READONLY_BUSY_REASON = "The AI is working on this site…";

/**
 * Re-mint at 80% of the token's remaining life, floored so a pathologically
 * short TTL (or a clock skew that makes one look nearly expired) can't turn
 * the refresh into a request loop.
 */
const TOKEN_REFRESH_FRACTION = 0.8;
const MIN_TOKEN_REFRESH_MS = 5_000;
// D815 — retry cadence after a FAILED mint. Starts short enough to recover
// within a token's remaining validity (refresh fires at 80% of a 15-min TTL,
// leaving ~3 min), then backs off exponentially so a persistently-broken
// endpoint isn't hammered every 20s for as long as the tab is open.
const TOKEN_RETRY_BASE_MS = 20_000;
const TOKEN_RETRY_MAX_MS = 5 * 60 * 1000;
/** Used only if the server's `expires_at` is unparseable. Server default is 15 min. */
const FALLBACK_TOKEN_TTL_MS = 10 * 60 * 1000;

type PreviewToken = { token: string; expiresAt: number };

export interface SitePreviewPanelProps {
  siteId: string;
  previewPageId: string | null;
  previewNonce: number;
  agentBusy: boolean;
}

/**
 * Draft preview column (P12-T12; Task 11 adds inline edit mode). Only
 * mounted while the AI drawer is open, so its pages-list fallback fetch
 * (`GET /api/sites/:id/pages`) doesn't fire on every site-detail load — that
 * GET is otherwise identical to the one the (lazily-mounted) Pages tab
 * already makes. Shows the page from the latest drawer change event,
 * falling back to the site's first page.
 *
 * Edit mode: the "Edit" toggle spins up an `InlineEditorHandle` (Task 9)
 * bridged into the iframe via `&edit=1&bridge=${token}`, wires its
 * image-pick/link-edit requests to `<ImagePickerDialog>`/`<LinkPopover>`,
 * and surfaces its save-state as a chip. `agentBusy` (lifted from the
 * drawer's `onStatusChange`) forces the handle readonly while the AI is
 * actively writing to the same site — editing over its writes would race.
 *
 * The `previewNonce`/page-id change-event reload is suppressed for the
 * WHOLE edit session, not just while dirty (final review Important 3) — a
 * reload would tear down the contenteditable session mid-keystroke, and a
 * page-id swap specifically would remount the iframe onto a page the live
 * `InlineEditorHandle` isn't saving to, silently dropping edits made on it.
 * The latest queued page/nonce is applied once edit mode turns off.
 */
export function SitePreviewPanel({
  siteId,
  previewPageId,
  previewNonce,
  agentBusy,
}: SitePreviewPanelProps) {
  const { data: pagesData, loading: pagesLoading } = useApi<{ pages: { id: string }[] }>(
    `/api/sites/${siteId}/pages`,
  );
  const firstPageId = pagesData?.pages[0]?.id ?? null;
  const effectivePreviewPageId = previewPageId ?? firstPageId;

  // Legacy fallback ONLY (see the preview-token block below): the paste-token
  // /login flow is the only thing that ever writes this, so it is null for
  // every Google-OAuth operator in production.
  const adminToken = getAdminToken();

  const [previewToken, setPreviewToken] = useState<PreviewToken | null>(null);
  // The token actually embedded in the CURRENTLY RENDERED src. Deliberately
  // separate from `previewToken`: React writes `src` straight through to the
  // element, so adopting a refreshed token immediately would NAVIGATE the live
  // iframe — fine when idle, silent data loss mid-edit-session.
  const [srcToken, setSrcToken] = useState<string | null>(null);

  const [edit, setEdit] = useState(false);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [imagePick, setImagePick] = useState<{ blockId: string; field: string; alt?: string } | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ blockId: string; field: string; value: string } | null>(null);
  const [displayed, setDisplayed] = useState({ pageId: effectivePreviewPageId, nonce: previewNonce });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handleRef = useRef<InlineEditorHandle | null>(null);
  const mountedRef = useRef(true);

  // Suppressed-reload queue: while edit mode is ON at all, hold onto
  // whatever page/nonce the drawer's change events point at rather than
  // applying it immediately — applied below once edit exits.
  //
  // Final review Important 3: this used to only suppress while `dirty`
  // (`if (edit && dirty) return;`). A change event can swap
  // `effectivePreviewPageId` to a DIFFERENT page while edit mode is on but
  // idle/saved (not dirty) — e.g. the AI writes another page while the
  // operator is mid-edit-session on this one. That immediately remounted
  // the iframe onto the new page (the iframe `key` includes
  // `displayed.pageId`), while the live `InlineEditorHandle` — created once
  // in `toggleEdit` and closed over the page id it started with — kept
  // right on saving to the OLD page. Any edits the operator then made on
  // the newly-shown page were silently dropped: nothing was editing it.
  // Pinning `displayed.pageId` for the ENTIRE edit session (not just while
  // dirty) means the iframe never moves out from under the live handle;
  // the queued page/nonce is applied the moment `edit` flips back to false.
  useEffect(() => {
    if (edit) return;
    setDisplayed({ pageId: effectivePreviewPageId, nonce: previewNonce });
  }, [effectivePreviewPageId, previewNonce, edit]);

  /**
   * PREVIEW CREDENTIAL (2026-07-30, operator-reported prod break).
   *
   * The iframe below is `sandbox="allow-scripts"` with no `allow-same-origin`,
   * so it loads from an opaque origin: it sends NO cookies (the Studio session
   * can't authenticate it) and, being an <iframe>, can set no headers either
   * (`X-Admin-Token` can't reach it). Its query string is the only channel.
   *
   * This used to put `getAdminToken()` there — the LEGACY localStorage token
   * from the deprecated paste-token /login. Prod operators sign in with
   * Google, so that read returned null, the src degraded to `?v=0`, and the
   * preview route 401'd every single load (a blank preview column, forever).
   *
   * Now: this component asks the server for a short-lived, SITE-SCOPED token
   * over `apiFetch` — a normal SPA request, so the session cookie authorizes
   * it — and puts that in the query string instead. A leaked preview URL is
   * worth ≤15 minutes of read access to one site's drafts, not the admin API.
   * See src/server/preview-token.ts.
   *
   * Refresh is PROACTIVE (a timer at ~80% of the TTL), not reactive: there is
   * no 401 to react to. The frame is on an opaque origin, so `onLoad` fires
   * identically for a 401 body and a 200 one and the parent can read neither
   * the status nor the document.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // D815 — consecutive-failure count; resets on any successful mint.
    let retryAttempt = 0;

    // A token is scoped to ONE site — the server 401s it anywhere else — so a
    // site switch must drop the old one rather than briefly reuse it.
    setPreviewToken(null);
    setSrcToken(null);

    async function mint(): Promise<void> {
      try {
        const res = await apiFetch<{ token: string; expires_at: string }>(
          `/api/sites/${siteId}/preview-token`,
          { method: "POST" },
        );
        if (cancelled) return;
        retryAttempt = 0;
        const parsed = Date.parse(res.expires_at);
        const expiresAt = Number.isNaN(parsed) ? Date.now() + FALLBACK_TOKEN_TTL_MS : parsed;
        setPreviewToken({ token: res.token, expiresAt });
        const delay = Math.max(
          MIN_TOKEN_REFRESH_MS,
          Math.floor((expiresAt - Date.now()) * TOKEN_REFRESH_FRACTION),
        );
        timer = setTimeout(() => void mint(), delay);
      } catch (err) {
        if (cancelled) return;
        // D815 (coordinating with D801): a 401 means the SESSION lapsed —
        // apiFetch just raised the shared session-expired signal and the
        // re-auth dialog is showing. Every further mint would 401 identically
        // until the operator re-authenticates (which remounts this panel),
        // so this loop must reach a TERMINAL state instead of hammering the
        // endpoint every 20s forever.
        if ((err instanceof ApiError && err.status === 401) || isSessionExpired()) return;
        // Anything else (transient network blip, older deployment, no
        // signing secret): keep any token we already hold — it stays valid
        // until its own expiry, and discarding it would blank a working
        // preview over one failed refresh. Retry with exponential backoff
        // (20s → 40s → … capped at 5 min); the legacy localStorage token
        // remains the last-resort fallback.
        const delay = Math.min(TOKEN_RETRY_BASE_MS * 2 ** retryAttempt, TOKEN_RETRY_MAX_MS);
        retryAttempt += 1;
        timer = setTimeout(() => void mint(), delay);
      }
    }

    void mint();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [siteId]);

  // Adopt a (re)minted token into the rendered src — but never while an edit
  // session is live, for the same reason `displayed.pageId` is pinned: the
  // src change navigates the iframe, tearing the contenteditable session down
  // under the live `InlineEditorHandle`. The pending token is adopted the
  // moment edit mode turns off (this effect re-runs on `edit`).
  useEffect(() => {
    if (edit) return;
    setSrcToken(previewToken?.token ?? null);
  }, [previewToken, edit]);

  /**
   * Flush + destroy whatever handle is live, then — fix-round-1 directed
   * extra — bump the displayed nonce once the flush resolves, so the plain
   * (non-edit) iframe that reappears actually re-fetches instead of showing
   * a URL a cache could legitimately still be holding stale from before the
   * edit session. Shared by the explicit toggle-off path (`toggleEdit`
   * below) and unmount.
   */
  function teardownHandle() {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    setEditToken(null);
    void handle
      .flush()
      .then(() => {
        // Guard against setting state after unmount — the flush is async
        // and this same function also runs from the unmount cleanup below.
        if (mountedRef.current) setDisplayed((d) => ({ ...d, nonce: d.nonce + 1 }));
      })
      .finally(() => {
        handle.destroy();
      });
  }

  // Unmount-only cleanup (e.g. the AI drawer/preview column closes mid-edit)
  // — `toggleEdit` below handles the in-app "Edit" off-click path itself so
  // that transition isn't deferred to a passive-effect cleanup.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      teardownHandle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agent-busy guard: force readonly while the drawer reports the AI is
  // actively working; re-run on `editToken` so a freshly-created handle
  // immediately picks up the current busy state.
  useEffect(() => {
    handleRef.current?.setReadonly(agentBusy, agentBusy ? READONLY_BUSY_REASON : undefined);
  }, [agentBusy, editToken]);

  function handleIframeLoad() {
    if (edit && handleRef.current && iframeRef.current) {
      handleRef.current.attach(iframeRef.current);
    }
  }

  /**
   * Edit toggle. Turning ON creates the `InlineEditorHandle` — and stashes
   * its token into state — SYNCHRONOUSLY, right here in the click handler,
   * alongside `setEdit(true)` (React 18 batches both into a single render).
   *
   * Fix-round-1 finding 1 (bridge-token race): the handle used to be
   * created in a `useEffect` keyed on `edit`. That meant the FIRST render
   * after the click always had `edit=true` but `editToken=null` — the
   * effect hadn't run yet — so the iframe mounted with a src missing
   * `&edit=1&bridge=`, then re-navigated a tick later once the effect set
   * the token (only harmless because `attach()` is idempotent). Creating
   * the handle here means `editToken` is already populated on the very
   * render that flips `edit` to true, so `previewSrc`/the iframe `key`
   * below are correct from that render's first paint — no tokenless mount,
   * no second navigation. (The alternative — gate the iframe on
   * `!edit || editToken` and fold `editToken` into its key — was passed
   * over: it still needs an extra render to "catch up", just hides it
   * behind a blank slot instead of removing it.)
   */
  function toggleEdit() {
    if (edit) {
      setEdit(false);
      teardownHandle();
      return;
    }
    if (!displayed.pageId) return;
    const handle = createInlineEditor({
      siteId,
      pageId: displayed.pageId,
      events: {
        // Final review Important 4: seed the dialog with the image block's
        // EXISTING alt text via the handle's `readProp` accessor (reads the
        // handle's local blocks — the same ones `applyImage` mutates and
        // saves). Without this, the dialog always opened with an empty alt
        // field, so any pick — even re-picking the exact same asset —
        // clobbered a previously-authored alt back to "". The prop name on
        // an image block is always literally "alt" (see
        // packages/components/src/blocks/image/schema.ts), independent of
        // which field ("asset_id") triggered the request.
        onImagePickRequest: (blockId, field) => {
          const alt = handleRef.current?.readProp(blockId, "alt");
          setImagePick({ blockId, field, alt: typeof alt === "string" ? alt : undefined });
        },
        onLinkEditRequest: (blockId, field, value) => setLinkEdit({ blockId, field, value }),
        onSaveStateChange: (s) => setSaveState(s),
      },
    });
    handleRef.current = handle;
    setEditToken(handle.token);
    setSaveState("idle");
    setEdit(true);
  }

  function handleImagePicked(picked: PickedImage) {
    if (imagePick && handleRef.current) {
      handleRef.current.applyImage(imagePick.blockId, imagePick.field, picked.asset_id, picked.src, picked.alt);
    }
    setImagePick(null);
  }

  function handleLinkSaved(url: string) {
    if (linkEdit && handleRef.current) {
      handleRef.current.applyField(linkEdit.blockId, linkEdit.field, url);
    }
    setLinkEdit(null);
  }

  // Item 9 (CodeRabbit — preview refresh): append `v=${nonce}` so every
  // change bumps to a genuinely distinct URL, not just a re-mounted
  // <iframe> pointed at the SAME url (which a cache — browser HTTP cache or
  // an intermediary — could legitimately serve stale for). Paired with the
  // preview route's own `Cache-Control: no-store` (admin-pages.ts).
  //
  // Credential precedence: the server-minted, site-scoped, short-lived token
  // when we have one; the legacy localStorage admin token only as a fallback
  // (dev / paste-token workflow, and any deployment whose mint endpoint isn't
  // available yet). The preview route accepts either.
  const iframeToken = srcToken ?? adminToken;
  const baseQuery = iframeToken
    ? `token=${encodeURIComponent(iframeToken)}&v=${displayed.nonce}`
    : `v=${displayed.nonce}`;
  const editQuery = edit && editToken ? `&edit=1&bridge=${encodeURIComponent(editToken)}` : "";
  const previewSrc = displayed.pageId
    ? `/api/sites/${siteId}/pages/${displayed.pageId}/preview?${baseQuery}${editQuery}`
    : null;

  // Task B6 (2026-07-30 lovable-workspace SDD, screenshot-driven follow-up):
  // this used to `return null` while there was no page to preview yet — on
  // the operator's screenshot that read as a small broken/empty box
  // floating in the frame. An intentional skeleton (still and 100% the
  // frame, `data-testid="draft-preview-panel"` so the wrapping frame in
  // `WorkspacePage` always has something to size against) replaces that
  // silent gap: "Loading preview…" while the pages fetch is in flight, or a
  // plain-language nudge once it's settled with nothing to show.
  if (!previewSrc) {
    return (
      <div
        data-testid="draft-preview-panel"
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-50/60 text-center"
      >
        {pagesLoading ? (
          <>
            <Spinner />
            <p className="text-sm text-zinc-400">Loading preview…</p>
          </>
        ) : (
          <p className="max-w-xs text-sm text-zinc-400">
            This page is empty — ask the agent to fill it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="draft-preview-panel" className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2">
        <div className="flex items-center gap-2">
          {edit && saveState === "saving" && <span className="text-xs text-zinc-500">Saving…</span>}
          {edit && saveState === "saved" && <span className="text-xs text-zinc-500">Saved · just now</span>}
          {edit && saveState === "error" && (
            // Minor (a): match the real behavior — a terminal save failure
            // does NOT keep auto-retrying (inline-editor.ts's
            // runSaveCycle retries exactly once, then stops and restores
            // the edit to `dirtyFields` so the NEXT edit or `flush()`
            // resends it, per its "Important 2" comment). "retrying" was
            // never true here.
            <span className="text-xs text-amber-600">Save failed — will retry on next edit</span>
          )}
          {agentBusy && <span className="text-xs text-amber-600">{READONLY_BUSY_REASON}</span>}
        </div>
        <button
          type="button"
          aria-pressed={edit}
          // Minor (b): only gate ENTERING edit mode on agentBusy — once
          // already editing, the operator must still be able to click
          // Edit to exit (which flushes + destroys the handle via
          // `toggleEdit`'s `if (edit)` branch above). Disabling exit too
          // trapped the operator in edit mode for the whole duration of
          // an AI run.
          disabled={agentBusy && !edit}
          onClick={toggleEdit}
          className={cn(
            "rounded-md border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
            edit
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
          )}
        >
          Edit
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title="Draft preview"
        src={previewSrc}
        key={`${displayed.pageId}:${displayed.nonce}:${edit}`}
        onLoad={handleIframeLoad}
        // Critical 2: the preview response is same-origin HTML rendered
        // from operator/AI-authored blocks — without a sandbox, an
        // embedded <script> block runs with the parent's origin (reachable
        // localStorage/cookies/DOM). `allow-scripts` alone (no
        // `allow-same-origin`) forces the iframe into an opaque, unique
        // origin: scripts still run (blocks that need them keep working),
        // but they can't read/write anything under the admin's real origin.
        sandbox="allow-scripts"
        // Task B6: no border/rounding of its own — `WorkspacePage` wraps
        // this whole panel in the rounded-xl, hairline-bordered, shadowed
        // frame ("like a browser window on a desk"); this just fills it.
        className="w-full flex-1 border-0"
      />

      <ImagePickerDialog
        siteId={siteId}
        open={imagePick !== null}
        initialAlt={imagePick?.alt}
        onClose={() => setImagePick(null)}
        onPick={handleImagePicked}
      />

      <LinkPopover
        open={linkEdit !== null}
        initialValue={linkEdit?.value}
        onClose={() => setLinkEdit(null)}
        onSave={handleLinkSaved}
      />
    </div>
  );
}
