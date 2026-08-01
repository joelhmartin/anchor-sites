import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BlockBodyEditor } from "../components/BlockBodyEditor.js";
import { useUnsavedGuard } from "../lib/useUnsavedGuard.js";
import type { Block } from "../../blocks/types.js";
import { ApiError, apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import type { SiteListRow } from "../lib/siteTypes.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { SeoPanel } from "../components/SeoPanel.js";
import type { SeoFields } from "../../server/seo/schema.js";

type EventDetail = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  description: Block[] | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  seo: Record<string, unknown> | null;
  status: "draft" | "published";
};

/** ISO → `datetime-local` value (local time, minute precision). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → ISO (UTC); empty → null. */
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Event editor (P8-T8.13). Mirrors PostEditorPage: resolves slug → site, loads
 * the event, edits metadata (title/dates/location/status) + the `description`
 * Block[] via the shared BlockBodyEditor (TipTap, Task B5), and saves it all
 * in one PUT.
 */
export function EventEditorPage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<{ sites: SiteListRow[] }>("/api/sites");

  if (loading) return <CenteredSpinner label="Loading…" />;
  if (error) return <ErrorCard message={`Couldn’t load sites: ${error}`} />;

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
  return <EventEditorView siteId={row.id} slug={row.slug} />;
}

function EventEditorView({ siteId, slug }: { siteId: string; slug: string }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useApi<{ event: EventDetail }>(
    `/api/sites/${siteId}/events/${eventId}`,
  );
  const event = data?.event;

  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [seo, setSeo] = useState<SeoFields>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // D421 — Starts is required; clearing it must refuse visibly, not silently
  // keep the old value (the `?? undefined` drop this replaces).
  const [startsError, setStartsError] = useState<string | null>(null);
  // D420 — unsaved-work flag; set by any metadata/body change, cleared on save.
  const [dirty, setDirty] = useState(false);
  const { confirmLeave } = useUnsavedGuard(dirty);

  // D430 — return to the Events tab we came from, not always Pages.
  const backTo = `/sites/${slug}/manage?tab=events`;
  function goBack(e: React.MouseEvent) {
    e.preventDefault();
    if (confirmLeave()) navigate(backTo);
  }

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setStartsAt(toLocalInput(event.starts_at));
      setEndsAt(toLocalInput(event.ends_at));
      setLocation(event.location ?? "");
      setStatus(event.status);
      setSeo((event.seo ?? {}) as SeoFields);
    }
  }, [event]);

  async function save(blocks: Block[]) {
    // D421 — a required Starts value, validated before the round-trip.
    const startsIso = fromLocalInput(startsAt);
    if (!startsIso) {
      setStartsError("Start date and time is required.");
      return;
    }
    setStartsError(null);
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/events/${eventId}`, {
        method: "PUT",
        body: {
          title: title.trim(),
          starts_at: startsIso,
          ends_at: fromLocalInput(endsAt),
          location: location.trim() || undefined,
          status,
          description: blocks,
          seo,
        },
      });
      setSavedAt(new Date().toISOString());
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn’t save this event.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CenteredSpinner label="Loading event…" />;
  if (error) return <ErrorCard message={`Couldn’t load this event: ${error}`} />;
  if (!event) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Link to={backTo} onClick={goBack} className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Back to {slug}
          </Link>
          <h1 className="text-lg font-semibold">{title || event.title}</h1>
          <p className="text-xs text-zinc-400">/events/{event.slug}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {saving && (
            <span className="flex items-center gap-1 text-zinc-500">
              <Spinner /> Saving…
            </span>
          )}
          {!saving && saveError && <span className="text-red-600">{saveError}</span>}
          {!saving && !saveError && savedAt && <span className="text-green-600">Saved ✓</span>}
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => {
                setDirty(true);
                setTitle(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-starts">Starts</Label>
            <Input
              id="event-starts"
              type="datetime-local"
              required
              aria-invalid={startsError ? true : undefined}
              value={startsAt}
              onChange={(e) => {
                setDirty(true);
                setStartsError(null);
                setStartsAt(e.target.value);
              }}
            />
            {startsError && <p className="text-xs text-red-600">{startsError}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-ends">Ends (optional)</Label>
            <Input
              id="event-ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => {
                setDirty(true);
                setEndsAt(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-location">Location (optional)</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => {
                setDirty(true);
                setLocation(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-status">Status</Label>
            <select
              id="event-status"
              value={status}
              onChange={(e) => {
                setDirty(true);
                setStatus(e.target.value as "draft" | "published");
              }}
              className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <SeoPanel
        siteId={siteId}
        value={seo}
        onChange={(v) => {
          setDirty(true);
          setSeo(v);
        }}
      />

      <p className="text-xs text-zinc-500">
        Edit the event description below, then use the{" "}
        <strong>{status === "published" ? "Publish" : "Save draft"}</strong> button to save (details,
        SEO, and description are saved together). The <strong>Status</strong> field above decides
        whether this goes live.
      </p>

      <BlockBodyEditor
        slug={slug}
        value={event.description ?? []}
        onSave={save}
        saveLabel={status === "published" ? "Publish" : "Save draft"}
        onDirty={() => setDirty(true)}
      />
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Spinner /> {label}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="pt-5 text-sm text-red-600">{message}</CardContent>
    </Card>
  );
}
