import type { SeoFields } from "../../server/seo/schema.js";
import { ImagePicker } from "../../editor/custom-fields/image-field.js";

/**
 * Reusable SEO editor (P9-T9.7, D-049). Edits a content item's `seo` blob —
 * the SAME `SeoFields` shape stored on pages, posts and events — so the page,
 * post and event editors share one panel. og:image uses the media-library
 * picker (operator-approved). Empty strings are pruned to `undefined` so the
 * stored blob stays clean and round-trips through `seoFieldsSchema`.
 */
export function SeoPanel({
  value,
  onChange,
  siteId,
}: {
  value: SeoFields;
  onChange: (next: SeoFields) => void;
  siteId: string;
}) {
  const blank = (s: string | undefined) => (s && s.trim() ? s : undefined);
  const set = (patch: Partial<SeoFields>) => onChange({ ...value, ...patch });
  const setOg = (patch: Partial<NonNullable<SeoFields["og"]>>) => {
    const og = { ...value.og, ...patch };
    const cleaned = Object.fromEntries(Object.entries(og).filter(([, v]) => v));
    set({ og: Object.keys(cleaned).length ? (cleaned as SeoFields["og"]) : undefined });
  };
  const robots = value.robots ?? { index: true, follow: true };
  const setRobots = (patch: Partial<{ index: boolean; follow: boolean }>) =>
    set({ robots: { index: robots.index ?? true, follow: robots.follow ?? true, ...patch } });

  const labelCls = "text-xs font-medium text-zinc-600";
  const inputCls = "w-full rounded border border-zinc-200 p-2 text-sm";

  return (
    <div
      className="flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50/60 p-3"
      aria-label="SEO settings"
    >
      <h3 className="text-sm font-medium">SEO</h3>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>SEO title</span>
        <input
          className={inputCls}
          value={value.title ?? ""}
          onChange={(e) => set({ title: blank(e.target.value) })}
          placeholder="Defaults to the page title"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Meta description</span>
        <textarea
          className={inputCls}
          rows={2}
          maxLength={320}
          value={value.description ?? ""}
          onChange={(e) => set({ description: blank(e.target.value) })}
          placeholder="Shown in search results (≤160 chars recommended)"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Canonical URL</span>
        <input
          className={inputCls}
          type="url"
          value={value.canonical ?? ""}
          onChange={(e) => set({ canonical: blank(e.target.value) })}
          placeholder="Leave blank to use this page's own URL"
        />
      </label>

      <fieldset className="flex gap-4">
        <legend className={labelCls}>Search engines</legend>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={robots.index ?? true}
            onChange={(e) => setRobots({ index: e.target.checked })}
          />
          Index this page
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={robots.follow ?? true}
            onChange={(e) => setRobots({ follow: e.target.checked })}
          />
          Follow links
        </label>
      </fieldset>

      <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-2">
        <span className={labelCls}>Social share (Open Graph)</span>
        <input
          className={inputCls}
          value={value.og?.title ?? ""}
          onChange={(e) => setOg({ title: blank(e.target.value) })}
          placeholder="Share title (defaults to the SEO title)"
          aria-label="Open Graph title"
        />
        <textarea
          className={inputCls}
          rows={2}
          value={value.og?.description ?? ""}
          onChange={(e) => setOg({ description: blank(e.target.value) })}
          placeholder="Share description"
          aria-label="Open Graph description"
        />
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Share image</span>
          <ImagePicker
            siteId={siteId}
            value={value.og?.imageAssetId ?? ""}
            onChange={(id) => setOg({ imageAssetId: id || undefined })}
          />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Twitter card</span>
        <select
          className={inputCls}
          value={value.twitter?.card ?? ""}
          onChange={(e) =>
            set({
              twitter: e.target.value
                ? { card: e.target.value as "summary" | "summary_large_image" }
                : undefined,
            })
          }
        >
          <option value="">Default (large image)</option>
          <option value="summary">Summary</option>
          <option value="summary_large_image">Summary, large image</option>
        </select>
      </label>
    </div>
  );
}
