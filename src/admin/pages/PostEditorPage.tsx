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

type PostDetail = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: Block[] | null;
  seo: Record<string, unknown> | null;
  status: "draft" | "published";
};

/**
 * Blog post editor (P8-T8.13). Resolves slug → site (the Phase-4/5 client
 * pattern), loads the post, edits metadata (title/excerpt/status) + the `body`
 * Block[] via the shared BlockBodyEditor (TipTap, Task B5), and saves
 * everything in one PUT. Slug is fixed after creation (changing a published
 * URL is a deliberate, rarer action left to a later task).
 */
export function PostEditorPage() {
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
  return <PostEditorView siteId={row.id} slug={row.slug} />;
}

function PostEditorView({ siteId, slug }: { siteId: string; slug: string }) {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useApi<{ post: PostDetail }>(
    `/api/sites/${siteId}/posts/${postId}`,
  );
  const post = data?.post;

  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [seo, setSeo] = useState<SeoFields>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // D420 — unsaved-work flag; set by any metadata/body change, cleared on save.
  const [dirty, setDirty] = useState(false);
  const { confirmLeave } = useUnsavedGuard(dirty);

  // D430 — return to the Blog tab we came from, not always Pages.
  const backTo = `/sites/${slug}/manage?tab=blog`;
  function goBack(e: React.MouseEvent) {
    e.preventDefault();
    if (confirmLeave()) navigate(backTo);
  }

  // Seed the metadata form once the post loads.
  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setExcerpt(post.excerpt ?? "");
      setStatus(post.status);
      setSeo((post.seo ?? {}) as SeoFields);
    }
  }, [post]);

  async function save(blocks: Block[]) {
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/posts/${postId}`, {
        method: "PUT",
        body: {
          title: title.trim(),
          excerpt: excerpt.trim() || undefined,
          status,
          body: blocks,
          seo,
        },
      });
      setSavedAt(new Date().toISOString());
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn’t save this post.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CenteredSpinner label="Loading post…" />;
  if (error) return <ErrorCard message={`Couldn’t load this post: ${error}`} />;
  if (!post) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Link to={backTo} onClick={goBack} className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Back to {slug}
          </Link>
          <h1 className="text-lg font-semibold">{title || post.title}</h1>
          <p className="text-xs text-zinc-400">/blog/{post.slug}</p>
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
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              value={title}
              onChange={(e) => {
                setDirty(true);
                setTitle(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="post-excerpt">Excerpt</Label>
            <Input
              id="post-excerpt"
              value={excerpt}
              onChange={(e) => {
                setDirty(true);
                setExcerpt(e.target.value);
              }}
              placeholder="Short summary (optional)"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="post-status">Status</Label>
            <select
              id="post-status"
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
        Edit the post body below, then use the <strong>{status === "published" ? "Publish" : "Save draft"}</strong>{" "}
        button to save (title, excerpt, status, SEO, and body are saved together). The{" "}
        <strong>Status</strong> field above decides whether this goes live.
      </p>

      <BlockBodyEditor
        slug={slug}
        value={post.body ?? []}
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
