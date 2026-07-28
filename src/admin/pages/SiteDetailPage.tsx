import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { liveSiteUrl } from "../lib/siteUrl.js";
import { getAdminToken } from "../lib/adminToken.js";
import type { AgentChangeEvent, AiConversation } from "../lib/agent-api.js";
import type { SiteDetail, SiteListRow, SiteStatus } from "../lib/siteTypes.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";
import { PagesTab } from "./site-tabs/PagesTab.js";
import { BlogTab } from "./site-tabs/BlogTab.js";
import { EventsTab } from "./site-tabs/EventsTab.js";
import { MediaTab } from "./site-tabs/MediaTab.js";
import { SettingsTab } from "./site-tabs/SettingsTab.js";
import { PluginsTab } from "./site-tabs/PluginsTab.js";
import { MembersTab } from "./site-tabs/MembersTab.js";
import { SeoSettingsTab } from "./site-tabs/SeoSettingsTab.js";
import { DomainsTab } from "./site-tabs/DomainsTab.js";
import { CrmTab } from "./site-tabs/CrmTab.js";
import { SaveAsTemplateDialog } from "../components/SaveAsTemplateDialog.js";
import { AgentChatDrawer } from "../components/AgentChatDrawer.js";
import { createInlineEditor, type InlineEditorHandle } from "../lib/inline-editor.js";
import { ImagePickerDialog } from "../components/ImagePickerDialog.js";
import type { PickedImage } from "../components/image-sources.js";
import { LinkPopover } from "../components/LinkPopover.js";

const statusTone: Record<SiteStatus, "success" | "neutral" | "warning"> = {
  active: "success",
  archived: "neutral",
  suspended: "warning",
};

const TABS = [
  { key: "pages", label: "Pages" },
  { key: "blog", label: "Blog" },
  { key: "events", label: "Events" },
  { key: "members", label: "Members" },
  { key: "media", label: "Media" },
  { key: "plugins", label: "Plugins" },
  { key: "domains", label: "Domains" },
  { key: "integrations", label: "Integrations" },
  { key: "seo", label: "SEO" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Site detail shell (P4-T4.12). The URL routes by slug, but the detail/pages/
 * media endpoints key off the site UUID, so we resolve slug → id from the
 * already-cheap `GET /api/sites` list, then render `<SiteDetailView>` which
 * loads the full detail by id. Each tab mounts only when active, so its list
 * fetch is lazy (4.13–4.15 fill in the tab bodies).
 */
export function SiteDetailPage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Spinner /> Loading site…
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm text-red-600">Couldn’t load sites: {error}</CardContent>
      </Card>
    );
  }

  const row = data?.sites.find((s) => s.slug === slug);
  if (!row) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-5">
          <p className="text-sm text-zinc-600">No site found for “{slug}”.</p>
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Back to sites
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <SiteDetailView siteId={row.id} slug={row.slug} />;
}

function SiteDetailView({ siteId, slug }: { siteId: string; slug: string }) {
  const [tab, setTab] = useState<TabKey>("pages");
  const { data, loading, error, reload } = useApi<{ site: SiteDetail }>(`/api/sites/${siteId}`);
  const site = data?.site;

  // P12-T12 "Start with AI": the wizard's AI path lands here with `?ai=1` to
  // pop the Studio drawer open and start tailing the job-run conversation it
  // just kicked off. `previewPageId`/`previewNonce` live here (fed by the
  // drawer's onChangeEvent, which fires regardless of whether the preview
  // column is mounted) but the pages-list fallback fetch itself lives in
  // <DraftPreview>, which only mounts while the drawer is open — otherwise
  // every site-detail load would issue the same GET the (lazily-mounted)
  // Pages tab already makes.
  const [searchParams] = useSearchParams();
  const [aiOpen, setAiOpen] = useState(searchParams.get("ai") === "1");
  const [previewPageId, setPreviewPageId] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  // Bot-review fix wave item 8: the wizard's AI path lands here with
  // `ai_error=1` when the site was created but kicking off the initial
  // build's conversation/job failed — the drawer opens empty (no
  // conversation exists yet), which would otherwise look unexplained.
  const aiError = searchParams.get("ai_error") === "1";

  // Task 11 agent-busy guard: lifted from the drawer's onStatusChange so
  // <DraftPreview> can force its inline editor readonly while the agent is
  // actively working the site — editing over the AI's own writes would race.
  const [agentBusy, setAgentBusy] = useState(false);

  function handleChangeEvent(c: AgentChangeEvent) {
    if (c.page_id) setPreviewPageId(c.page_id);
    setPreviewNonce((n) => n + 1);
  }

  function handleStatusChange(_status: AiConversation["status"] | null, busy: boolean) {
    setAgentBusy(busy);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Sites
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{site?.display_name ?? slug}</h1>
            {site && <Badge tone={statusTone[site.status]}>{site.status}</Badge>}
          </div>
          <div className="flex items-center gap-3">
            {site && <SaveAsTemplateDialog siteId={site.id} siteName={site.display_name} />}
            {site && (
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                aria-pressed={aiOpen}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                AI
              </button>
            )}
            <a
              href={liveSiteUrl(slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              View live site ↗
            </a>
          </div>
        </div>
        <p className="text-sm text-zinc-500">{slug}</p>
      </div>

      {aiError && (
        <Card>
          <CardContent className="pt-5 text-sm text-amber-700">
            The site was created, but the initial AI build couldn’t be started automatically. Send a
            message in Studio chat to kick it off.
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading…
        </div>
      )}
      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load this site: {error}</CardContent>
        </Card>
      )}

      {site && (
        <>
          <div role="tablist" className="flex gap-1 border-b border-zinc-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                  tab === t.key
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-zinc-500 hover:text-zinc-700",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex gap-4">
            <div role="tabpanel" className="min-w-0 flex-1">
              {tab === "pages" && <PagesTab siteId={site.id} slug={slug} />}
              {tab === "blog" && <BlogTab siteId={site.id} slug={slug} />}
              {tab === "events" && <EventsTab siteId={site.id} slug={slug} />}
              {tab === "members" && <MembersTab siteId={site.id} />}
              {tab === "media" && <MediaTab siteId={site.id} />}
              {tab === "plugins" && <PluginsTab siteId={site.id} />}
              {tab === "domains" && <DomainsTab siteId={site.id} />}
              {tab === "integrations" && <CrmTab site={site} />}
              {tab === "seo" && <SeoSettingsTab site={site} />}
              {tab === "settings" && <SettingsTab site={site} />}
            </div>

            {aiOpen && (
              <DraftPreview
                siteId={siteId}
                previewPageId={previewPageId}
                previewNonce={previewNonce}
                agentBusy={agentBusy}
              />
            )}
          </div>

          <AgentChatDrawer
            siteId={site.id}
            slug={slug}
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            onSiteChanged={reload}
            autoTail={searchParams.get("ai") === "1"}
            onChangeEvent={handleChangeEvent}
            onStatusChange={handleStatusChange}
          />
        </>
      )}
    </div>
  );
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const READONLY_BUSY_REASON = "The AI is working on this site…";

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
 * The `previewNonce` change-event reload is suppressed while an edit
 * session is dirty/saving (a reload would tear down the contenteditable
 * session mid-keystroke); the latest page/nonce is applied once the save
 * settles or edit mode turns off.
 */
function DraftPreview({
  siteId,
  previewPageId,
  previewNonce,
  agentBusy,
}: {
  siteId: string;
  previewPageId: string | null;
  previewNonce: number;
  agentBusy: boolean;
}) {
  const { data: pagesData } = useApi<{ pages: { id: string }[] }>(`/api/sites/${siteId}/pages`);
  const firstPageId = pagesData?.pages[0]?.id ?? null;
  const effectivePreviewPageId = previewPageId ?? firstPageId;

  const adminToken = getAdminToken();

  const [edit, setEdit] = useState(false);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [imagePick, setImagePick] = useState<{ blockId: string; field: string } | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ blockId: string; field: string; value: string } | null>(null);
  const [displayed, setDisplayed] = useState({ pageId: effectivePreviewPageId, nonce: previewNonce });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handleRef = useRef<InlineEditorHandle | null>(null);

  const dirty = saveState === "dirty" || saveState === "saving";

  // Suppressed-reload queue: while an edit session is dirty, hold onto
  // whatever page/nonce the drawer's change events point at rather than
  // applying it immediately — applied below once dirty clears or edit exits.
  useEffect(() => {
    if (edit && dirty) return;
    setDisplayed({ pageId: effectivePreviewPageId, nonce: previewNonce });
  }, [effectivePreviewPageId, previewNonce, edit, dirty]);

  // Create/destroy the inline editor handle as edit mode toggles.
  useEffect(() => {
    if (!edit || !displayed.pageId) return;
    const handle = createInlineEditor({
      siteId,
      pageId: displayed.pageId,
      events: {
        onImagePickRequest: (blockId, field) => setImagePick({ blockId, field }),
        onLinkEditRequest: (blockId, field, value) => setLinkEdit({ blockId, field, value }),
        onSaveStateChange: (s) => setSaveState(s),
      },
    });
    handleRef.current = handle;
    setEditToken(handle.token);
    return () => {
      handleRef.current = null;
      setEditToken(null);
      void handle.flush().finally(() => handle.destroy());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, siteId, displayed.pageId]);

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
  const baseQuery = adminToken
    ? `token=${encodeURIComponent(adminToken)}&v=${displayed.nonce}`
    : `v=${displayed.nonce}`;
  const editQuery = edit && editToken ? `&edit=1&bridge=${encodeURIComponent(editToken)}` : "";
  const previewSrc = displayed.pageId
    ? `/api/sites/${siteId}/pages/${displayed.pageId}/preview?${baseQuery}${editQuery}`
    : null;

  if (!previewSrc) return null;

  return (
    <div
      data-testid="draft-preview-panel"
      className={cn("flex w-full flex-col gap-2", edit ? "max-w-3xl" : "max-w-md")}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Draft preview</p>
        <div className="flex items-center gap-2">
          {edit && saveState === "saving" && <span className="text-xs text-zinc-500">Saving…</span>}
          {edit && saveState === "saved" && <span className="text-xs text-zinc-500">Saved · just now</span>}
          {edit && saveState === "error" && (
            <span className="text-xs text-amber-600">Save failed — retrying</span>
          )}
          {agentBusy && <span className="text-xs text-amber-600">{READONLY_BUSY_REASON}</span>}
          <button
            type="button"
            aria-pressed={edit}
            disabled={agentBusy}
            onClick={() => setEdit((v) => !v)}
            className={cn(
              "rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50",
              edit
                ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-50",
            )}
          >
            Edit
          </button>
        </div>
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
        className={cn("w-full rounded border border-zinc-200", edit ? "h-[70vh]" : "h-96")}
      />

      <ImagePickerDialog
        siteId={siteId}
        open={imagePick !== null}
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
