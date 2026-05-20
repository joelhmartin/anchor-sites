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
 * time, an Edit affordance routing to the Phase-5 editor placeholder, and an
 * inline new-page form (`POST /api/sites/:siteId/pages`) that refreshes the
 * list on success.
 */
export function PagesTab({ siteId, slug }: { siteId: string; slug: string }) {
  const { data, loading, error, reload } = useApi<{ pages: PageRow[] }>(
    `/api/sites/${siteId}/pages`,
  );
  const navigate = useNavigate();
  const pages = data?.pages ?? [];

  const [showForm, setShowForm] = useState(false);
  const [pageSlug, setPageSlug] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(pageSlug);
  const canSubmit = title.trim().length > 0 && slugValid && !busy;

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
      setShowForm(false);
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
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New page"}
        </Button>
      </div>

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
                    <TD>{new Date(p.updated_at).toLocaleDateString()}</TD>
                    <TD>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/sites/${slug}/pages/${p.id}`)}
                      >
                        Edit
                      </Button>
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
