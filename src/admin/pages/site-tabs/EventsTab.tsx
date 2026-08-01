import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Badge, type BadgeProps } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../ui/table.js";

type EventRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  starts_at: string;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "published") return "success";
  if (status === "draft") return "warning";
  return "neutral";
}

/**
 * Events tab (P8-T8.13). Lists a site's events (soonest-first) with a status
 * badge + start time, an inline new-event form (slug + title + start), and an
 * Edit affordance routing to the Puck-backed event editor. Mirrors BlogTab.
 */
export function EventsTab({ siteId, slug }: { siteId: string; slug: string }) {
  const { data, loading, error, reload } = useApi<{ events: EventRow[] }>(
    `/api/sites/${siteId}/events`,
  );
  const navigate = useNavigate();
  const events = data?.events ?? [];

  // D407 — per-row delete (confirm-gated). DELETE route exists in
  // admin-tenant.ts; it just had no UI.
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteEvent(ev: EventRow) {
    if (!window.confirm(`Delete the event “${ev.title}”? This can’t be undone.`)) return;
    setDeleteBusy(ev.id);
    setDeleteError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/events/${ev.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn’t delete the event.");
    } finally {
      setDeleteBusy(null);
    }
  }

  const [showForm, setShowForm] = useState(false);
  const [eventSlug, setEventSlug] = useState("");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(eventSlug);
  const canSubmit = title.trim().length > 0 && slugValid && startsAt !== "" && !busy;

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch<{ event: { id: string } }>(`/api/sites/${siteId}/events`, {
        method: "POST",
        body: { slug: eventSlug, title: title.trim(), starts_at: new Date(startsAt).toISOString() },
      });
      setEventSlug("");
      setTitle("");
      setStartsAt("");
      setShowForm(false);
      navigate(`/sites/${slug}/events/${res.event.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(`An event with the slug “${eventSlug}” already exists on this site.`);
      } else {
        setFormError(err instanceof Error ? err.message : "Couldn’t create the event.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Events</h2>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New event"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-5">
            {/* Admin chrome, not a CRM embed. */}
            <form onSubmit={createEvent} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-title">Title</Label>
                <Input
                  id="event-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Open house"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-slug">Slug</Label>
                <Input
                  id="event-slug"
                  value={eventSlug}
                  onChange={(e) => setEventSlug(e.target.value)}
                  placeholder="open-house"
                  aria-invalid={eventSlug.length > 0 && !slugValid}
                />
                {eventSlug.length > 0 && !slugValid && (
                  <p className="text-xs text-red-600">
                    Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-starts">Starts</Label>
                <Input
                  id="event-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                  {busy ? <Spinner /> : "Create event"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading events…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load events: {error}</CardContent>
        </Card>
      )}

      {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}

      {!loading && !error && events.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No events yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {!loading && !error && events.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Slug</TH>
                  <TH>Status</TH>
                  <TH>Starts</TH>
                  <TH>{""}</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((ev) => (
                  <TR key={ev.id}>
                    <TD className="font-medium text-zinc-900">{ev.title}</TD>
                    <TD>{ev.slug}</TD>
                    <TD>
                      <Badge tone={statusTone(ev.status)}>{ev.status}</Badge>
                    </TD>
                    <TD>{new Date(ev.starts_at).toLocaleString()}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/sites/${slug}/events/${ev.id}`)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          disabled={deleteBusy === ev.id}
                          onClick={() => deleteEvent(ev)}
                        >
                          {deleteBusy === ev.id ? <Spinner /> : "Delete"}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
