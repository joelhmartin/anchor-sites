import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { resolveTemplateCover, validateAllTemplates } from "../../db/seed-templates.js";
import { allTemplates } from "../../db/templates/index.js";
import type { PixabayImage } from "../../src/server/media/pixabay.js";

/**
 * Task C4: unit coverage for the cover-ingestion design (see seed-templates.ts's
 * header comment) and the "every registered template validates" gate that
 * tasks C5-C14 will rely on. Pure logic + an injected pool double — no
 * database or network required.
 */

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

describe("resolveTemplateCover (Task C4)", () => {
  it("does nothing when cover is null", async () => {
    const { pool, calls } = fakePool(null);
    await resolveTemplateCover(pool, "tpl-1", null);
    expect(calls.length).toBe(0);
  });

  it("skips (no write) when the template already has a cover_image_url", async () => {
    const { pool, calls } = fakePool("https://cdn.pixabay.com/existing.jpg");
    const search = stockSearch("api", [
      { id: 1, tags: "x", previewURL: "p", largeImageURL: "https://pixabay.com/get/new.jpg", imageWidth: 1280, imageHeight: 853, user: "u", pageURL: "pg" },
    ]);
    await resolveTemplateCover(pool, "tpl-1", { stock_query: "dentist office", alt: "a dentist office" }, { searchStock: search });
    expect(search).not.toHaveBeenCalled();
    // Only the SELECT ran — no UPDATE.
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });

  it("stores the direct URL as-is for a { url, alt } cover, no Pixabay call", async () => {
    const { pool, calls } = fakePool(null);
    await resolveTemplateCover(pool, "tpl-1", { url: "https://example.com/cover.jpg", alt: "cover" });
    const update = calls.find((c) => c.text.trim().startsWith("UPDATE"));
    expect(update?.params).toEqual(["https://example.com/cover.jpg", "tpl-1"]);
  });

  it("resolves a stock_query cover via Pixabay and stores the largeImageURL", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("api", [
      { id: 42, tags: "dentist", previewURL: "p", largeImageURL: "https://pixabay.com/get/42_1280.jpg", imageWidth: 1280, imageHeight: 853, user: "u", pageURL: "pg" },
    ]);
    await resolveTemplateCover(pool, "tpl-1", { stock_query: "dentist office", alt: "a dentist office" }, { searchStock: search });
    expect(search).toHaveBeenCalledWith("dentist office", expect.objectContaining({ perPage: 3 }));
    const update = calls.find((c) => c.text.trim().startsWith("UPDATE"));
    expect(update?.params).toEqual(["https://pixabay.com/get/42_1280.jpg", "tpl-1"]);
  });

  it("skips cleanly (no write, no throw) when PIXABAY_API_KEY is absent (stub mode)", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("stub", [
      { id: 1, tags: "stub", previewURL: "https://example.invalid/p.jpg", largeImageURL: "https://example.invalid/1280.jpg", imageWidth: 1280, imageHeight: 853, user: "stub", pageURL: "https://example.invalid" },
    ]);
    await expect(
      resolveTemplateCover(pool, "tpl-1", { stock_query: "dentist office", alt: "a dentist office" }, { searchStock: search }),
    ).resolves.toBeUndefined();
    expect(calls.filter((c) => c.text.trim().startsWith("UPDATE")).length).toBe(0);
  });

  it("skips cleanly when the API returns zero hits", async () => {
    const { pool, calls } = fakePool(null);
    const search = stockSearch("api", []);
    await resolveTemplateCover(pool, "tpl-1", { stock_query: "nonexistent-query-xyz", alt: "x" }, { searchStock: search });
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
