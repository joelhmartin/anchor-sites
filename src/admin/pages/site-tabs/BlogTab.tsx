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

type PostRow = {
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
 * Blog tab (P8-T8.13). Lists a site's posts with a status badge + last-edited
 * time, an inline new-post form (`POST /api/sites/:siteId/posts`), and an Edit
 * affordance routing to the Puck-backed post editor. Mirrors PagesTab.
 */
export function BlogTab({ siteId, slug }: { siteId: string; slug: string }) {
  const { data, loading, error, reload } = useApi<{ posts: PostRow[] }>(
    `/api/sites/${siteId}/posts`,
  );
  const navigate = useNavigate();
  const posts = data?.posts ?? [];

  const [showForm, setShowForm] = useState(false);
  const [postSlug, setPostSlug] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // D406 — per-row delete (confirm-gated). The DELETE route already exists
  // (admin-tenant.ts); it just had no UI. Keyed by id so rows spinner alone.
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deletePost(p: PostRow) {
    if (!window.confirm(`Delete the post “${p.title}”? This can’t be undone.`)) return;
    setDeleteBusy(p.id);
    setDeleteError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/posts/${p.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn’t delete the post.");
    } finally {
      setDeleteBusy(null);
    }
  }

  const slugValid = SLUG_RE.test(postSlug);
  const canSubmit = title.trim().length > 0 && slugValid && !busy;

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch<{ post: { id: string } }>(`/api/sites/${siteId}/posts`, {
        method: "POST",
        body: { slug: postSlug, title: title.trim() },
      });
      setPostSlug("");
      setTitle("");
      setShowForm(false);
      // Jump straight into the editor for the new post.
      navigate(`/sites/${slug}/posts/${res.post.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(`A post with the slug “${postSlug}” already exists on this site.`);
      } else {
        setFormError(err instanceof Error ? err.message : "Couldn’t create the post.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Blog</h2>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New post"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-5">
            {/* Admin chrome, not a CRM embed. */}
            <form onSubmit={createPost} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="post-title">Title</Label>
                <Input
                  id="post-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Announcing our new clinic"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="post-slug">Slug</Label>
                <Input
                  id="post-slug"
                  value={postSlug}
                  onChange={(e) => setPostSlug(e.target.value)}
                  placeholder="announcing-our-new-clinic"
                  aria-invalid={postSlug.length > 0 && !slugValid}
                />
                {postSlug.length > 0 && !slugValid && (
                  <p className="text-xs text-red-600">
                    Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen.
                  </p>
                )}
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                  {busy ? <Spinner /> : "Create post"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading posts…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load posts: {error}</CardContent>
        </Card>
      )}

      {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}

      {!loading && !error && posts.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No posts yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {!loading && !error && posts.length > 0 && (
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
                {posts.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-zinc-900">{p.title}</TD>
                    <TD>{p.slug}</TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </TD>
                    <TD>{formatDateTime(p.updated_at)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/sites/${slug}/posts/${p.id}`)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          disabled={deleteBusy === p.id}
                          onClick={() => deletePost(p)}
                        >
                          {deleteBusy === p.id ? <Spinner /> : "Delete"}
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
