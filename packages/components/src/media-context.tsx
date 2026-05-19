import * as React from "react";

/**
 * Media hydration context (P3-T3.12 / P3-T3.14).
 *
 * The renderer queries `media_assets` for any asset_ids referenced by
 * the page's blocks, then wraps `<BlockRenderer>` in `<MediaProvider>`
 * so the `<Image>` block can resolve its `asset_id` to a populated
 * asset (alt, focal_point, variants, dimensions) without any DB access
 * inside the component.
 *
 * Package consumers can build their own provider for stories/previews.
 */

export type MediaVariant = {
  name: "thumbnail" | "sm" | "md" | "lg" | "2x";
  format: "webp" | "jpg";
  width: number;
  height: number;
  url: string;
};

export type MediaAssetData = {
  id: string;
  alt: string;
  width?: number;
  height?: number;
  focal_point?: { x: number; y: number } | null;
  variants: MediaVariant[];
};

export type MediaContextValue = {
  getAsset: (id: string) => MediaAssetData | undefined;
};

export const MediaContext = React.createContext<MediaContextValue | null>(null);

export function useMediaContext(): MediaContextValue | null {
  return React.useContext(MediaContext);
}

/**
 * Provider wrapper. Accepts either an array of assets (we index by id)
 * or a custom resolver.
 */
export function MediaProvider({
  assets,
  resolve,
  children,
}: {
  assets?: MediaAssetData[];
  resolve?: (id: string) => MediaAssetData | undefined;
  children: React.ReactNode;
}) {
  const value = React.useMemo<MediaContextValue>(() => {
    if (resolve) return { getAsset: resolve };
    const byId = new Map((assets ?? []).map((a) => [a.id, a]));
    return { getAsset: (id) => byId.get(id) };
  }, [assets, resolve]);
  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}
