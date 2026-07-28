/**
 * Pixabay search for the AI site agent. Mode mirrors src/server/ai/config.ts:
 * no PIXABAY_API_KEY = deterministic stub hits, zero network — dev + CI never
 * touch the API. Stub URLs use example.invalid so an accidental real fetch
 * fails loudly (import_image special-cases them — see tools/assets.ts).
 */
export type PixabayImage = {
  id: number; tags: string; previewURL: string; largeImageURL: string;
  imageWidth: number; imageHeight: number; user: string; pageURL: string;
};

const STUB_HITS: PixabayImage[] = [1, 2, 3].map((n) => ({
  id: n, tags: "stub, placeholder",
  previewURL: `https://example.invalid/stub-${n}-preview.jpg`,
  largeImageURL: `https://example.invalid/stub-${n}-1280.jpg`,
  imageWidth: 1280, imageHeight: 853, user: "stub", pageURL: `https://example.invalid/stub-${n}`,
}));

export async function searchPixabay(
  q: string,
  opts: { perPage?: number; env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch } = {},
): Promise<{ mode: "stub" | "api"; hits: PixabayImage[] }> {
  const env = opts.env ?? process.env;
  const key = env.PIXABAY_API_KEY;
  if (!key) return { mode: "stub", hits: STUB_HITS };

  const fetchFn = opts.fetchFn ?? fetch;
  // Item 14 (CodeRabbit — verified against Pixabay's docs: `per_page`'s
  // documented minimum is 3): the agent tool's own schema
  // (tools/assets.ts's searchStockImagesParams) allows 1-20, so a request
  // for 1 or 2 would otherwise reach the real API and get rejected outright
  // — clamp the OUTGOING value up to 3 rather than letting that 400 happen.
  const outgoingPerPage = Math.max(opts.perPage ?? 9, 3);
  const params = new URLSearchParams({
    key, q, image_type: "photo", safesearch: "true",
    per_page: String(outgoingPerPage),
  });
  const res = await fetchFn(`https://pixabay.com/api/?${params.toString()}`);
  if (!res.ok) throw new Error(`pixabay search failed: ${res.status}`);
  const body = (await res.json()) as { hits?: unknown[] };
  const hits = (body.hits ?? []).map((h) => {
    const x = h as Record<string, unknown>;
    return {
      id: Number(x.id), tags: String(x.tags ?? ""), previewURL: String(x.previewURL ?? ""),
      largeImageURL: String(x.largeImageURL ?? x.webformatURL ?? ""),
      imageWidth: Number(x.imageWidth ?? 0), imageHeight: Number(x.imageHeight ?? 0),
      user: String(x.user ?? ""), pageURL: String(x.pageURL ?? ""),
    };
  });
  return { mode: "api", hits };
}
