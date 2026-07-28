import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import { useApi } from "../lib/useApi.js";
import { pickLargest, pickThumb, type Variant } from "../lib/media-utils.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Spinner } from "../ui/spinner.js";

/**
 * Image sources for `ImagePickerDialog` (Task 10). Each source is data +
 * behavior — the dialog just renders a tab strip over `imageSources` and
 * hands the active one `{ siteId, alt, onPick, onError }`. This is the
 * AI-generation seam: adding a `"generate"` source later means adding one
 * more entry here; nothing in the dialog changes.
 */

export type PickedImage = { asset_id: string; alt: string; src: string };

export type ImageSourceProps = {
  siteId: string;
  alt: string;
  onPick: (p: PickedImage) => void;
  onError: (msg: string) => void;
};

export type ImageSource = {
  id: "library" | "upload" | "stock";
  label: string;
  Component: ComponentType<ImageSourceProps>;
};

type MediaAsset = { id: string; alt: string; variants_status: string; variants: Variant[] | null };
type SignedUpload = { asset_id: string; upload_url: string; headers: Record<string, string> };
type StockHit = { preview: string; download_url: string; credit?: string };

/**
 * Poll interval/timeout for "wait until the asset's variants are ready"
 * (upload + stock import both need this). Exported as a mutable config
 * object purely as a test seam — tests shrink it so polling resolves near-
 * instantly instead of waiting out the real 1.5s/20s cadence.
 */
export const POLL_CONFIG = { intervalMs: 1500, timeoutMs: 20000 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `GET /media` until `assetId` reports `variants_status: "ready"`, or give up. */
async function pollForReady(siteId: string, assetId: string): Promise<MediaAsset | null> {
  const deadline = Date.now() + POLL_CONFIG.timeoutMs;
  while (Date.now() < deadline) {
    await delay(POLL_CONFIG.intervalMs);
    const res = await apiFetch<{ media: MediaAsset[] }>(`/api/sites/${siteId}/media?limit=60`);
    const found = res.media.find((m) => m.id === assetId);
    if (found && found.variants_status === "ready") return found;
  }
  return null;
}

/** Resolve a (possibly still-pending) asset to the `PickedImage` shape. */
function toPicked(asset: MediaAsset | null, assetId: string, alt: string): PickedImage {
  const largest = asset ? pickLargest(asset.variants) : null;
  return { asset_id: assetId, alt, src: largest?.url ?? "" };
}

/** Runs the shared "upload/import, then poll for ready" tail used by Upload + Stock. */
async function pickAfterReady(
  siteId: string,
  assetId: string,
  alt: string,
  onPick: (p: PickedImage) => void,
  onError: (msg: string) => void,
) {
  const ready = await pollForReady(siteId, assetId);
  if (!ready) onError("Still processing — the image will appear once it’s ready.");
  onPick(toPicked(ready, assetId, alt));
}

/** Library: pick from already-uploaded, ready media. */
function LibrarySource({ siteId, alt, onPick, onError }: ImageSourceProps) {
  const { data, loading, error } = useApi<{ media: MediaAsset[] }>(`/api/sites/${siteId}/media?limit=60`);
  useEffect(() => {
    if (error) onError(error);
    // Only re-fire when the error text itself changes — `onError` is not
    // guaranteed to be a stable reference across parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const ready = (data?.media ?? []).filter((m) => m.variants_status === "ready" && pickThumb(m.variants));

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
        <Spinner /> Loading media…
      </div>
    );
  }
  if (ready.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">No media yet.</p>;
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {ready.map((asset) => {
        const thumb = pickThumb(asset.variants)!;
        return (
          <button
            key={asset.id}
            type="button"
            className="aspect-square overflow-hidden rounded-md border border-zinc-200"
            onClick={() => onPick(toPicked(asset, asset.id, alt))}
          >
            <img src={thumb.url} alt={asset.alt} className="h-full w-full object-cover" />
          </button>
        );
      })}
    </div>
  );
}

/** Upload: the Phase-3 3-step flow (upload-url → PUT → complete), then poll for ready. */
function UploadSource({ siteId, alt, onPick, onError }: ImageSourceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    try {
      // 1. Mint a signed upload URL + create the pending asset row.
      const signed = await apiFetch<SignedUpload>(`/api/sites/${siteId}/media/upload-url`, {
        method: "POST",
        body: { content_type: file.type, alt: file.name },
      });
      // 2. Upload the bytes straight to GCS (raw fetch — no admin token to GCS).
      const put = await fetch(signed.upload_url, { method: "PUT", headers: signed.headers, body: file });
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
      // 3. Tell the API the bytes landed; it enqueues variant processing.
      await apiFetch(`/api/sites/${siteId}/media/${signed.asset_id}/complete`, { method: "POST" });

      await pickAfterReady(siteId, signed.asset_id, alt, onPick, onError);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Button disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Spinner /> : "Choose file…"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="picker-upload-input"
        onChange={onFile}
      />
    </div>
  );
}

/** Stock: search + import from the stock provider, then poll for ready like an upload. */
function StockSource({ siteId, alt, onPick, onError }: ImageSourceProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StockHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ hits: StockHit[] }>(`/api/sites/${siteId}/media/stock-search`, {
        method: "POST",
        body: { query: query.trim() },
      });
      setHits(res.hits);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function pick(hit: StockHit) {
    setImportingUrl(hit.download_url);
    try {
      const imported = await apiFetch<{ asset_id: string }>(`/api/sites/${siteId}/media/stock-import`, {
        method: "POST",
        body: { url: hit.download_url, alt },
      });
      await pickAfterReady(siteId, imported.asset_id, alt, onPick, onError);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingUrl(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stock photos…"
          aria-label="Search stock photos"
        />
        <Button type="submit" disabled={searching}>
          {searching ? <Spinner /> : "Search"}
        </Button>
      </form>
      {hits.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {hits.map((hit) => (
            <button
              key={hit.download_url}
              type="button"
              className="relative aspect-square overflow-hidden rounded-md border border-zinc-200"
              disabled={!!importingUrl}
              onClick={() => pick(hit)}
            >
              <img src={hit.preview} alt={hit.credit ?? ""} className="h-full w-full object-cover" />
              {importingUrl === hit.download_url && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Spinner />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const imageSources: ImageSource[] = [
  { id: "library", label: "Library", Component: LibrarySource },
  { id: "upload", label: "Upload", Component: UploadSource },
  { id: "stock", label: "Stock photos", Component: StockSource },
];
