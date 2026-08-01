import { useRef, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { pickThumb, type Variant } from "../../lib/media-utils.js";
import { Badge, type BadgeProps } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";

type MediaAsset = {
  id: string;
  alt: string;
  content_type: string;
  variants_status: string;
  variants: Variant[] | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

type SignedUpload = {
  asset_id: string;
  upload_url: string;
  headers: Record<string, string>;
};

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

/**
 * One asset tile (D431/D417). Focusable (keyboard + touch can reach the
 * metadata via `focus-within`, not just hover), and the alt text is editable
 * inline via `PATCH .../media/:id`.
 */
function MediaTile({
  siteId,
  asset,
  onSaved,
  onRemoved,
}: {
  siteId: string;
  asset: MediaAsset;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const thumb = pickThumb(asset.variants);
  const ready = asset.variants_status === "ready" && thumb;
  const [editing, setEditing] = useState(false);
  const [alt, setAlt] = useState(asset.alt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function saveAlt() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/media/${asset.id}`, {
        method: "PATCH",
        body: { alt: alt.trim() },
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save alt text.");
    } finally {
      setBusy(false);
    }
  }

  // D106/D408/D511 — remove (archive) the asset from the library, confirm-gated.
  async function remove() {
    if (
      !window.confirm(
        "Remove this image from the library? Pages already using it keep working; " +
          "it just won’t appear here anymore.",
      )
    ) {
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      await apiFetch(`/api/sites/${siteId}/media/${asset.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t remove the image.");
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        // D431 — focusable tile; overlay shows on hover OR keyboard focus.
        tabIndex={0}
        className="group relative aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 focus-within:ring-2 focus-within:ring-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {ready ? (
          <img src={thumb!.url} alt={asset.alt} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Badge tone={statusTone(asset.variants_status)}>{asset.variants_status}</Badge>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/60 p-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="truncate">{asset.alt || "No alt text"}</span>
          {asset.width && asset.height && (
            <span className="text-white/70">
              {asset.width}×{asset.height}
            </span>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-1">
          <Input
            aria-label={`Alt text for image ${asset.id}`}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className="text-xs"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-1">
            <Button size="sm" onClick={saveAlt} disabled={busy}>
              {busy ? <Spinner /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setAlt(asset.alt ?? ""); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs text-indigo-600 hover:text-indigo-700"
            onClick={() => setEditing(true)}
          >
            {asset.alt ? "Edit alt text" : "Add alt text"}
          </button>
          <button
            type="button"
            className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
            onClick={remove}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
      {!editing && error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Media tab (P4-T4.14). A grid of the site's media assets (`GET .../media`)
 * showing the smallest ready variant as a thumbnail, plus an upload widget
 * that runs the Phase-3 three-step flow: `POST .../media/upload-url` → browser
 * `PUT` to the signed GCS URL → `POST .../media/:id/complete`, then refreshes
 * the grid (the variant job flips the asset to `ready` asynchronously).
 */
export function MediaTab({ siteId }: { siteId: string }) {
  const { data, loading, error, reload } = useApi<{ media: MediaAsset[] }>(
    `/api/sites/${siteId}/media`,
  );
  const media = data?.media ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // D417 — alt text captured at upload time (the upload no longer defaults alt
  // to the filename). Empty is allowed; it stays editable per-tile afterward.
  const [altDraft, setAltDraft] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploading(file.name);
    setUploadError(null);
    const alt = altDraft.trim();
    try {
      // 1. Mint a signed upload URL + create the pending asset row.
      const signed = await apiFetch<SignedUpload>(
        `/api/sites/${siteId}/media/upload-url`,
        { method: "POST", body: { content_type: file.type, alt } },
      );
      // 2. Upload the bytes straight to GCS (raw fetch — no admin token to GCS).
      const put = await fetch(signed.upload_url, {
        method: "PUT",
        headers: signed.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
      // 3. Tell the API the bytes landed; it enqueues variant processing.
      await apiFetch(`/api/sites/${siteId}/media/${signed.asset_id}/complete`, {
        method: "POST",
      });
      setAltDraft("");
      reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-medium">Media</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="media-alt-draft">Alt text for next upload</Label>
            <Input
              id="media-alt-draft"
              value={altDraft}
              onChange={(e) => setAltDraft(e.target.value)}
              placeholder="e.g. Dentist examining a patient"
              className="w-64"
            />
          </div>
          <Button size="sm" variant="outline" onClick={reload}>
            Refresh
          </Button>
          <Button size="sm" disabled={!!uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Spinner /> : "Upload image"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="media-upload-input"
            onChange={onPick}
          />
        </div>
      </div>

      {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading media…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">Couldn’t load media: {error}</CardContent>
        </Card>
      )}

      {!loading && !error && media.length === 0 && !uploading && (
        <Card>
          <CardContent className="pt-5 text-sm text-zinc-600">
            No media yet. Upload an image to get started.
          </CardContent>
        </Card>
      )}

      {(media.length > 0 || uploading) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {uploading && (
            <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500">
              <Spinner />
              <span className="px-2 text-center">Uploading {uploading}…</span>
            </div>
          )}
          {media.map((asset) => (
            <MediaTile key={asset.id} siteId={siteId} asset={asset} onSaved={reload} onRemoved={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
