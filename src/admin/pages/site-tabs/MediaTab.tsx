import { useRef, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Badge, type BadgeProps } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Spinner } from "../../ui/spinner.js";

type Variant = {
  name: string;
  format: string;
  width: number;
  height: number;
  url: string;
  bytes: number;
};

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

/** Smallest ready variant for a thumbnail; prefer webp on a width tie. */
function pickThumb(variants: Variant[] | null): Variant | null {
  if (!variants || variants.length === 0) return null;
  return [...variants].sort(
    (a, b) => a.width - b.width || (a.format === "webp" ? -1 : 1),
  )[0];
}

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  return "warning";
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

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploading(file.name);
    setUploadError(null);
    try {
      // 1. Mint a signed upload URL + create the pending asset row.
      const signed = await apiFetch<SignedUpload>(
        `/api/sites/${siteId}/media/upload-url`,
        { method: "POST", body: { content_type: file.type, alt: file.name } },
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
      reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Media</h2>
        <div className="flex items-center gap-2">
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
          {media.map((asset) => {
            const thumb = pickThumb(asset.variants);
            const ready = asset.variants_status === "ready" && thumb;
            return (
              <div
                key={asset.id}
                className="group relative aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
              >
                {ready ? (
                  <img
                    src={thumb!.url}
                    alt={asset.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Badge tone={statusTone(asset.variants_status)}>{asset.variants_status}</Badge>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/60 p-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="truncate">{asset.alt || "—"}</span>
                  {asset.width && asset.height && (
                    <span className="text-white/70">
                      {asset.width}×{asset.height}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
