import { describe, it, expect, vi } from "vitest";
import { searchPixabay } from "./pixabay.js";

const FIXTURE = {
  hits: [{
    id: 111, tags: "dentist, smile", previewURL: "https://cdn.pixabay.com/p/111.jpg",
    largeImageURL: "https://pixabay.com/get/111_1280.jpg", imageWidth: 1280,
    imageHeight: 853, user: "photog", pageURL: "https://pixabay.com/photos/111/",
  }],
};

describe("searchPixabay", () => {
  it("returns deterministic stub hits when PIXABAY_API_KEY is unset", async () => {
    const res = await searchPixabay("dentist office", { env: {} as NodeJS.ProcessEnv });
    expect(res.mode).toBe("stub");
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0].largeImageURL).toContain("example.invalid");
  });

  it("calls the API with key + query + safesearch, returns typed hits", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch;
    const res = await searchPixabay("dentist office", {
      env: { PIXABAY_API_KEY: "k123" } as NodeJS.ProcessEnv, fetchFn, perPage: 5,
    });
    expect(res.mode).toBe("api");
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("key=k123");
    expect(url).toContain("q=dentist+office");
    expect(url).toContain("safesearch=true");
    expect(url).toContain("per_page=5");
    expect(res.hits[0]).toMatchObject({ id: 111, user: "photog" });
  });

  // Item 14 (CodeRabbit): Pixabay's documented per_page minimum is 3 — a
  // caller-requested 1 or 2 must not reach the real API as-is (it 400s).
  it("clamps a per_page of 1 or 2 up to Pixabay's minimum of 3 in the outgoing request", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch;
    await searchPixabay("dentist office", {
      env: { PIXABAY_API_KEY: "k123" } as NodeJS.ProcessEnv, fetchFn, perPage: 1,
    });
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("per_page=3");
  });

  it("leaves a per_page of 3 or more unchanged", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => FIXTURE })) as unknown as typeof fetch;
    await searchPixabay("dentist office", {
      env: { PIXABAY_API_KEY: "k123" } as NodeJS.ProcessEnv, fetchFn, perPage: 12,
    });
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("per_page=12");
  });

  it("throws a descriptive error on non-OK responses", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(
      searchPixabay("x", { env: { PIXABAY_API_KEY: "k" } as NodeJS.ProcessEnv, fetchFn }),
    ).rejects.toThrow(/pixabay.*429/i);
  });
});
