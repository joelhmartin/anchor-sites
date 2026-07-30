import { useState } from "react";
import { apiFetch } from "../lib/apiFetch.js";

type Variant = { format: string; width: number; url: string };
type MediaAsset = {
  id: string;
  alt: string;
  variants_status: string;
  variants: Variant[] | null;
};

/** Smallest ready variant for a thumbnail; prefer webp on a width tie. */
function pickThumb(variants: Variant[] | null): Variant | null {
  if (!variants || variants.length === 0) return null;
  return [...variants].sort((a, b) => a.width - b.width || (a.format === "webp" ? -1 : 1))[0];
}

/**
 * Site media-library asset picker (P5-T5.7). Reused by the SEO panel's
 * og:image field. Originally lived at `src/editor/custom-fields/image-field.tsx`
 * as a Puck custom field wrapper around this same component; relocated here
 * (Task B5, 2026-07-30 lovable-workspace SDD) when Puck was removed — the
 * Puck-specific `imageField()` wrapper went with it, but the picker itself has
 * no Puck dependency and is still needed by `SeoPanel`/`SeoSettingsTab`.
 */
export function ImagePicker({
  value,
  onChange,
  siteId,
}: {
  value: string;
  onChange: (value: string) => void;
  siteId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!siteId) {
      setError("No site context for the media library.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ media: MediaAsset[] }>(`/api/sites/${siteId}/media`);
      setMedia(data.media);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load media.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && media === null && !loading) void load();
  }

  const selected = media?.find((m) => m.id === value) ?? null;
  const selectedThumb = selected ? pickThumb(selected.variants) : null;

  return (
    <div className="ac-image-picker flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {value ? (
          selectedThumb ? (
            <img
              src={selectedThumb.url}
              alt=""
              className="h-12 w-12 rounded border border-zinc-200 object-cover"
            />
          ) : (
            <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600">{value}</span>
          )
        ) : (
          <span className="text-xs text-zinc-400">No image selected</span>
        )}
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
        >
          {open ? "Close" : "Choose image"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-zinc-500 hover:text-red-600"
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <div className="rounded border border-zinc-200 p-2">
          {loading && <p className="text-xs text-zinc-500">Loading media…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {media && media.length === 0 && (
            <p className="text-xs text-zinc-500">No media yet — upload in the Media tab.</p>
          )}
          {media && media.length > 0 && (
            <div className="grid grid-cols-3 gap-2" role="listbox" aria-label="Media library">
              {media.map((asset) => {
                const thumb = pickThumb(asset.variants);
                const ready = asset.variants_status === "ready" && thumb;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    role="option"
                    aria-selected={asset.id === value}
                    onClick={() => {
                      onChange(asset.id);
                      setOpen(false);
                    }}
                    title={asset.alt}
                    className={`aspect-square overflow-hidden rounded border ${
                      asset.id === value
                        ? "border-indigo-500 ring-1 ring-indigo-300"
                        : "border-zinc-200"
                    }`}
                  >
                    {ready ? (
                      <img
                        src={thumb!.url}
                        alt={asset.alt}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                        {asset.variants_status}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
