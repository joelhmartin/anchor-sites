import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { formatDateTime } from "../../lib/datetime.js";
import { Badge, type BadgeProps } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../ui/table.js";

type PageRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  updated_at: string;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "published") return "success";
  if (status === "draft") return "warning";
  return "neutral";
}

/**
 * Pages tab (P4-T4.13). Lists a site's pages with a status badge + last-edited
 * time, an Edit affordance routing to the workspace with this page preselected
 * (`?page=<id>`, Task B5 — Puck's page editor is gone), and an inline
 * new-page form (`POST /api/sites/:siteId/pages`) that refreshes the list on
 * success.
 */
export function PagesTab({ siteId, slug }: { siteId: string; slug: string }) {
  const { data, loading, error, reload } = useApi<{ pages: PageRow[] }>(
    `/api/sites/${siteId}/pages`,
  );
  const navigate = useNavigate();
  const pages = data?.pages ?? [];

  // D432 — the "+ New page" and "Add from template" forms are two competing
  // creation flows; a single `mode` keeps them mutually exclusive on screen
  // (opening one closes the other) instead of stacking both open at once.
  const [mode, setMode] = useState<"none" | "new" | "template">("none");
  const showForm = mode === "new";
  const showTemplateForm = mode === "template";
  const [pageSlug, setPageSlug] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // "Add from template" (P7-T7.9). Page templates are fetched lazily when the
  // form opens (keeps the tab's mount-time fetch to just the pages list).
  const [pageTemplates, setPageTemplates] = useState<{ id: string; name: string; pages_count: number }[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplId, setTplId] = useState("");
  const [tplSlug, setTplSlug] = useState("");
  const [tplTitle, setTplTitle] = useState("");
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  // D436 — per-page publish/unpublish from the list (parity with Blog/Events
  // status controls). Keyed by page id so each row spinners independently.
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function setPageStatus(page: PageRow, next: "draft" | "published") {
    setStatusBusy(page.id);
    setStatusError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/pages/${page.id}/status`, {
        method: "PATCH",
        body: { status: next },
      });
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStatusError(err.message);
      } else {
        setStatusError(err instanceof Error ? err.message : "Couldn’t change the page status.");
      }
    } finally {
      setStatusBusy(null);
    }
  }

  const slugValid = SLUG_RE.test(pageSlug);
  const canSubmit = title.trim().length > 0 && slugValid && !busy;
  const tplSlugValid = tplSlug === "" || SLUG_RE.test(tplSlug);
  const canAddFromTemplate = tplId !== "" && tplSlugValid && !tplBusy;

  async function toggleTemplateForm() {
    const opening = mode !== "template";
    setMode(opening ? "template" : "none");
    if (opening) {
      setTplError(null);
      setTplId("");
      setTplSlug("");
      setTplTitle("");
      setTplLoading(true);
      try {
        const r = await apiFetch<{ templates: { id: string; name: string; pages_count: number }[] }>(
          "/api/templates?kind=page",
        );
        setPageTemplates(r.templates);
      } catch (err) {
        setTplError(err instanceof Error ? err.message : "Couldn’t load page templates.");
      } finally {
        setTplLoading(false);
      }
    }
  }

  async function addFromTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!canAddFromTemplate) return;
    setTplBusy(true);
    setTplError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/pages/from-template`, {
        method: "POST",
        body: { template_id: tplId, slug: tplSlug.trim() || undefined, title: tplTitle.trim() || undefined },
      });
      setMode("none");
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setTplError("A page with that slug already exists on this site.");
      } else {
        setTplError(err instanceof Error ? err.message : "Couldn’t add the page.");
      }
    } finally {
      setTplBusy(false);
    }
  }

  async function createPage(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/pages`, {
        method: "POST",
        body: { slug: pageSlug, title: title.trim() },
      });
      setPageSlug("");
      setTitle("");
      setMode("none");
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(`A page with the slug “${pageSlug}” already exists on this site.`);
      } else {
        setFormError(err instanceof Error ? err.message : "Couldn’t create the page.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Pages</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggleTemplateForm}>
            {showTemplateForm ? "Cancel" : "Add from template"}
          </Button>
          <Button size="sm" onClick={() => setMode((m) => (m === "new" ? "none" : "new"))}>
            {showForm ? "Cancel" : "+ New page"}
          </Button>
        </div>
      </div>

      {showTemplateForm && (
        <Card>
          <CardContent className="pt-5">
            {/* Admin chrome, not a CRM embed. */}
            <form onSubmit={addFromTemplate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl-pick">Page template</Label>
                {tplLoading ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Spinner /> Loading templates…
                  </div>
                ) : pageTemplates.length === 0 ? (
                  <p className="text-sm text-zinc-500">No page templates yet. Save a page as a template first.</p>
                ) : (
                  <select
                    id="tpl-pick"
                    value={tplId}
                    onChange={(e) => setTplId(e.target.value)}
                    className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  >
                    <option value="">Choose a template…</option>
                    {pageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl-slug">Slug (optional)</Label>
                <Input
                  id="tpl-slug"
                  value={tplSlug}
                  onChange={(e) => setTplSlug(e.target.value)}
                  placeholder="defaults to the template’s slug"
                  aria-invalid={tplSlug.length > 0 && !tplSlugValid}
                />
                {tplSlug.length > 0 && !tplSlugValid && (
                  <p className="text-xs text-red-600">
                    Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl-title">Title (optional)</Label>
                <Input
                  id="tpl-title"
                  value={tplTitle}
                  onChange={(e) => setTplTitle(e.target.value)}
                  placeholder="defaults to the template’s title"
                />
              </div>
              {tplError && <p className="text-sm text-red-600">{tplError}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={!canAddFromTemplate}>
                  {tplBusy ? <Spinner /> : "Add page"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardContent className="pt-5">
            {/* Admin chrome, not a CRM embed — the no-<form> anchor governs CRM/editor surfaces. */}
            <form onSubmit={createPage} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="page-title">Title</Label>
                <Input
                  id="page-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="About us"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="page-slug">Slug</Label>
                <Input
                  id="page-slug"
                  value={pageSlug}
                  onChange={(e) => setPageSlug(e.target.value)}
                  placeholder="about"
                  aria-invalid={pageSlug.length > 0 && !slugValid}
                />
                {pageSlug.length > 0 && !slugValid && (
                  <p className="text-xs text-red-600">
                    Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                  </p>
                )}
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                  {busy ? <Spinner /> : "Create page"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading pages…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load pages: {error}</CardContent>
        </Card>
      )}

      {statusError && <p className="text-sm text-red-600">{statusError}</p>}

      {!loading && !error && pages.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No pages yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {!loading && !error && pages.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Slug</TH>
                  <TH>Status</TH>
                  <TH>Updated</TH>
                  <TH>{""}</TH>
                </TR>
              </THead>
              <TBody>
                {pages.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-zinc-900">{p.title}</TD>
                    <TD>{p.slug}</TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </TD>
                    <TD>{formatDateTime(p.updated_at)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        {/* D436 — publish/unpublish without leaving the list. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={statusBusy === p.id}
                          onClick={() =>
                            setPageStatus(p, p.status === "published" ? "draft" : "published")
                          }
                        >
                          {statusBusy === p.id ? (
                            <Spinner />
                          ) : p.status === "published" ? (
                            "Unpublish"
                          ) : (
                            "Publish"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/sites/${slug}?page=${p.id}`)}
                        >
                          Edit
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
