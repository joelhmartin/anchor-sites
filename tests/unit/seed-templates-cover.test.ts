import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { resolveTemplateCover, validateAllTemplates } from "../../db/seed-templates.js";
import { allTemplates } from "../../db/templates/index.js";
import type { PixabayImage } from "../../src/server/media/pixabay.js";
import type { ProcessedVariant } from "../../src/server/media/variant-spec.js";

/**
 * Task C4 fix round 1: unit coverage for the cover-ingestion design (see
 * seed-templates.ts's header comment) and the "every registered template
 * validates" gate that tasks C5-C14 will rely on. Pure logic + injected
 * pool/ingest/processUpload doubles — no database or network required (the
 * system-site idempotence itself needs a real DB and is covered separately
 * in tests/integration/seed-templates.test.ts).
 */

const SYSTEM_SITE_ID = "system-site-id";

function fakePool(initialCoverUrl: string | null) {
  const calls: { text: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.trim().startsWith("SELECT")) {
        return { rows: [{ cover_image_url: initialCoverUrl }] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

function stockSearch(mode: "stub" | "api", hits: PixabayImage[]) {
  return vi.fn(async () => ({ mode, hits })) as unknown as typeof import("../../src/server/media/pixabay.js").searchPixabay;
}

function fakeVariants(): ProcessedVariant[] {
  return [
    { name: "thumbnail", format: "webp", width: 200, height: 133, url: "https://storage.googleapis.com/b/thumb.webp", bytes: 10 },
    { name: "md", format: "jpg", width: 768, height: 512, url: "https://storage.googleapis.com/b/md.jpg", bytes: 30 },
    { name: "md", format: "webp", width: 768, height: 512, url: "https://storage.googleapis.com/b/md.webp", bytes: 20 },
    { name: "lg", format: "webp", width: 1280, height: 853, url: "https://storage.googleapis.com/b/lg.webp", bytes: 40 },
  ];
}

function fakeIngest(assetId = "asset-1") {
  return vi.fn(async () => ({ asset_id: assetId, gcs_key: `originals/${SYSTEM_SITE_ID}/${assetId}.jpg` })) as unknown as typeof import(
    "../../src/server/media/ingest.js"
  ).ingestImageFromUrl;
}

function fakeProcessUpload(variants: ProcessedVariant[] = fakeVariants()) {
  return vi.fn(async (data: { asset_id: string }) => ({ asset_id: data.asset_id, variants })) as unknown as typeof import(
    "../../src/server/jobs/media-process-upload.js"
  ).handleMediaProcessUpload;
}

describe("resolveTemplateCover (Task C4 fix round 1 — ingest via media pipeline)", () => {
  it("does nothing when cover is null", async () => {
    const { pool, calls } = fakePool(null);
    await resolveTemplateCover(pool, "tpl-1", null, SYSTEM_SITE_ID);
    expect(calls.length).toBe(0);
  });

  it("skips (no ingest, no write) when the template already has a cover_image_url", async () => {
    const { pool, calls } = fakePool("https://storage.googleapis.com/b/existing.jpg");
    const search = stockSearch("api", [
      { id: 1, tags: "x", previewURL: "p", largeImageURL: "https://pixabay.com/get/new.jpg", imageWidth: 1280, imageHeight: 853, user: "u", pageURL: "pg" },
    ]);
    const ingest = fakeIngest();
    const processUpload = fakeProcessUpload();
    await resolveTemplateCover(
      pool,
      "tpl-1",
      { stock_query: "dentist office", alt: "a dentist office" },
      SYSTEM_SITE_ID,
      { searchStock: search, ingest, processUpload },
    );
    expect(search).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
    expect(processUpload).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });

  it("a { url, alt } cover is ingested directly (no Pixabay call) under the system site", async () => {
    const { pool, calls } = fakePool(null);
    const ingest = fakeIngest("asset-url");
    const processUpload = fakeProcessUpload();
    await resolveTemplateCover(pool, "tpl-1", { url: "https://example.com/cover.jpg", alt: "cover" }, SYSTEM_SITE_ID, {
      ingest,
      processUpload,
    });
    expect(ingest).toHaveBeenCalledWith(pool, { siteId: SYSTEM_SITE_ID, url: "https://example.com/cover.jpg", alt: "cover" });
    expect(processUpload).toHaveBeenCalledWith({ asset_id: "asset-url" }, { pool });
    const update = calls.find((c) => c.text.trim().startsWith("UPDATE"));
    // md/webp variant preferred.
    expect(update?.params).toEqual(["https://storage.googleapis.com/b/md.webp", "tpl-1"]);
  });

  it("resolves a stock_query cover via Pixabay, ingests the hit under the system site, and stores the md variant URL", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("api", [
      { id: 42, tags: "dentist", previewURL: "p", largeImageURL: "https://pixabay.com/get/42_1280.jpg", imageWidth: 1280, imageHeight: 853, user: "u", pageURL: "pg" },
    ]);
    const ingest = fakeIngest("asset-42");
    const processUpload = fakeProcessUpload();
    await resolveTemplateCover(
      pool,
      "tpl-1",
      { stock_query: "dentist office", alt: "a dentist office" },
      SYSTEM_SITE_ID,
      { searchStock: search, ingest, processUpload },
    );
    expect(search).toHaveBeenCalledWith("dentist office", expect.objectContaining({ perPage: 3 }));
    expect(ingest).toHaveBeenCalledWith(pool, {
      siteId: SYSTEM_SITE_ID,
      url: "https://pixabay.com/get/42_1280.jpg",
      alt: "a dentist office",
    });
    expect(processUpload).toHaveBeenCalledWith({ asset_id: "asset-42" }, { pool });
    const update = calls.find((c) => c.text.trim().startsWith("UPDATE"));
    expect(update?.params).toEqual(["https://storage.googleapis.com/b/md.webp", "tpl-1"]);
  });

  it("skips cleanly (no ingest, no throw) when PIXABAY_API_KEY is absent (stub mode)", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("stub", [
      { id: 1, tags: "stub", previewURL: "https://example.invalid/p.jpg", largeImageURL: "https://example.invalid/1280.jpg", imageWidth: 1280, imageHeight: 853, user: "stub", pageURL: "https://example.invalid" },
    ]);
    const ingest = fakeIngest();
    await expect(
      resolveTemplateCover(pool, "tpl-1", { stock_query: "dentist office", alt: "a dentist office" }, SYSTEM_SITE_ID, {
        searchStock: search,
        ingest,
      }),
    ).resolves.toBeUndefined();
    expect(ingest).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });

  it("skips cleanly when the API returns zero hits", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("api", []);
    const ingest = fakeIngest();
    await resolveTemplateCover(pool, "tpl-1", { stock_query: "nonexistent-query-xyz", alt: "x" }, SYSTEM_SITE_ID, {
      searchStock: search,
      ingest,
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });

  it("skips cleanly (no throw, no write) when ingest fails — e.g. no GCS credentials in this environment", async () => {
    const { pool, calls } = fakePool(null);
    const ingest = vi.fn(async () => {
      throw new Error("could not load the default credentials");
    }) as unknown as typeof import("../../src/server/media/ingest.js").ingestImageFromUrl;
    await expect(
      resolveTemplateCover(pool, "tpl-1", { url: "https://example.com/cover.jpg", alt: "cover" }, SYSTEM_SITE_ID, { ingest }),
    ).resolves.toBeUndefined();
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });
});

describe("validateAllTemplates (gate for C5-C14)", () => {
  it("every currently registered template's pages validate against the block registry", async () => {
    await expect(validateAllTemplates(allTemplates)).resolves.toBeUndefined();
  });

  it("throws with template + page context on an invalid block", async () => {
    await expect(
      validateAllTemplates([
        {
          slug: "broken",
          name: "Broken",
          description: "",
          category: null,
          sort_order: 0,
          brand_tokens: {},
          cover: null,
          pages: [
            {
              slug: "home",
              title: "Home",
              seo: {},
              sort_order: 0,
              blocks: [{ id: "b1", type: "not-a-real-block-type", props: {} }],
            },
          ],
        },
      ]),
    ).rejects.toThrow(/broken.*home.*invalid blocks/is);
  });
});
