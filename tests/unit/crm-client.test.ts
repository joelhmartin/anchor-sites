/**
 * P11-T11.6 — CRM client unit tests.
 * Uses a stubbed fetch layer for HttpCrmClient.
 */
import { describe, expect, it, vi } from "vitest";
import {
  HttpCrmClient,
  NullCrmClient,
  StubCrmClient,
} from "../../src/server/crm/client.js";
import { resolveCrmClient } from "../../src/server/crm/resolve.js";

function makeFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch;
}

function makeErrorFetch(status: number, message: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.reject(new Error("no json")),
    text: () => Promise.resolve(message),
  }) as unknown as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// HttpCrmClient — 5 endpoints happy path
// ---------------------------------------------------------------------------
describe("HttpCrmClient", () => {
  const BASE = "https://crm.example.com";
  const KEY = "test-key";

  it("provisionSite: POST /sites with siteId, name, primaryDomain", async () => {
    const fetch = makeFetch(201, { id: "crm-site-abc" });
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    const result = await client.provisionSite("site-1", "Acme Dental", "acme.example.com");
    expect(result).toEqual({ crmSiteId: "crm-site-abc" });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/sites`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updateSite: PATCH /sites/:id", async () => {
    const fetch = makeFetch(204, null);
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    await client.updateSite("crm-site-abc", { name: "New Name" });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/sites/crm-site-abc`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("deprovisionSite: DELETE /sites/:id", async () => {
    const fetch = makeFetch(204, null);
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    await client.deprovisionSite("crm-site-abc");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/sites/crm-site-abc`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("listPhoneNumbers: GET /sites/:id/phone-numbers", async () => {
    const numbers = [{ id: "n1", number: "+15550001111", display: "(555) 000-1111" }];
    const fetch = makeFetch(200, numbers);
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    const result = await client.listPhoneNumbers("crm-site-abc");
    expect(result).toEqual(numbers);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/sites/crm-site-abc/phone-numbers`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("listCampaigns: GET /sites/:id/campaigns", async () => {
    const campaigns = [{ id: "c1", name: "Spring Promo", status: "active" }];
    const fetch = makeFetch(200, campaigns);
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    const result = await client.listCampaigns("crm-site-abc");
    expect(result).toEqual(campaigns);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/sites/crm-site-abc/campaigns`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends Bearer Authorization header", async () => {
    const fetch = makeFetch(201, { id: "x" });
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: "my-key", fetch });
    await client.provisionSite("s", "n", "d");
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: "Bearer my-key" });
  });

  it("error path: throws on non-ok response", async () => {
    const fetch = makeErrorFetch(500, "internal error");
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    await expect(client.listCampaigns("crm-site-abc")).rejects.toThrow("500");
  });

  // FINAL whole-branch review, FIX-NOW item 4 — unbounded CRM call.
  it("aborts a hung request and reports a clear timeout error (final review, item 4)", async () => {
    // A fetch that only ever settles when its signal aborts — i.e. exactly
    // what an unresponsive anchor-hub looks like from here.
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch, timeoutMs: 20 });
    await expect(client.provisionSite("s", "n", "d")).rejects.toThrow(
      /CRM POST \/sites timed out after 20ms/,
    );
  });

  it("passes an AbortSignal on every request (default 10s budget)", async () => {
    const fetch = makeFetch(200, []);
    const client = new HttpCrmClient({ baseUrl: BASE, apiKey: KEY, fetch });
    await client.listCampaigns("x");
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((opts as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("strips trailing slash from baseUrl so paths have no double slash", async () => {
    const fetch = makeFetch(200, []);
    const client = new HttpCrmClient({ baseUrl: BASE + "/", apiKey: KEY, fetch });
    await client.listCampaigns("x");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // Check the path portion (after the host) has no double slash
    const pathPart = url.replace(/^https?:\/\/[^/]+/, "");
    expect(pathPart).not.toMatch(/\/\//);
  });
});

// ---------------------------------------------------------------------------
// StubCrmClient
// ---------------------------------------------------------------------------
describe("StubCrmClient", () => {
  it("provisionSite returns stub-<siteId>", async () => {
    const client = new StubCrmClient();
    const result = await client.provisionSite("uuid-123", "n", "d");
    expect(result.crmSiteId).toBe("stub-uuid-123");
  });

  it("listPhoneNumbers returns empty array", async () => {
    const client = new StubCrmClient();
    expect(await client.listPhoneNumbers("x")).toEqual([]);
  });

  it("listCampaigns returns empty array", async () => {
    const client = new StubCrmClient();
    expect(await client.listCampaigns("x")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// NullCrmClient
// ---------------------------------------------------------------------------
describe("NullCrmClient", () => {
  it("provisionSite returns empty crmSiteId without throwing", async () => {
    const client = new NullCrmClient();
    const r = await client.provisionSite("s", "n", "d");
    expect(r.crmSiteId).toBe("");
  });

  it("other methods resolve without throwing", async () => {
    const client = new NullCrmClient();
    await expect(client.updateSite("x", {})).resolves.toBeUndefined();
    await expect(client.deprovisionSite("x")).resolves.toBeUndefined();
    expect(await client.listPhoneNumbers("x")).toEqual([]);
    expect(await client.listCampaigns("x")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveCrmClient mode-switch
// ---------------------------------------------------------------------------
describe("resolveCrmClient", () => {
  it("returns NullCrmClient when CRM_DISABLED=true", () => {
    const client = resolveCrmClient({ CRM_DISABLED: "true", CRM_BASE_URL: "https://x", CRM_API_KEY: "k" });
    expect(client).toBeInstanceOf(NullCrmClient);
  });

  it("returns HttpCrmClient when CRM_BASE_URL + CRM_API_KEY present", () => {
    const client = resolveCrmClient({ CRM_BASE_URL: "https://x", CRM_API_KEY: "k" });
    expect(client).toBeInstanceOf(HttpCrmClient);
  });

  it("returns StubCrmClient when credentials absent in non-production", () => {
    const client = resolveCrmClient({ NODE_ENV: "development" });
    expect(client).toBeInstanceOf(StubCrmClient);
  });

  it("returns NullCrmClient in production without credentials (prevents stub IDs in DB)", () => {
    const client = resolveCrmClient({ NODE_ENV: "production" });
    expect(client).toBeInstanceOf(NullCrmClient);
  });
});
