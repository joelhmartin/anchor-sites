// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from "./adminToken.js";
import { ApiError, apiFetch } from "./apiFetch.js";

describe("adminToken storage (P4-T4.8)", () => {
  beforeEach(() => clearAdminToken());

  it("set / get / clear roundtrip", () => {
    expect(getAdminToken()).toBeNull();
    setAdminToken("tok-123");
    expect(getAdminToken()).toBe("tok-123");
    clearAdminToken();
    expect(getAdminToken()).toBeNull();
  });
});

describe("apiFetch (P4-T4.8)", () => {
  const realFetch = global.fetch;
  beforeEach(() => clearAdminToken());
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: unknown) {
    global.fetch = vi.fn(async () =>
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  it("attaches X-Admin-Token when present + JSON-encodes the body", async () => {
    setAdminToken("tok-xyz");
    const spy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = spy as unknown as typeof fetch;

    await apiFetch("/api/sites", { method: "POST", body: { slug: "x" } });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Token"]).toBe("tok-xyz");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ slug: "x" }));
  });

  it("omits the token header when none is stored", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    global.fetch = spy as unknown as typeof fetch;
    await apiFetch("/api/sites");
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Admin-Token"]).toBeUndefined();
  });

  it("parses + returns JSON on 200", async () => {
    mockFetch(200, { sites: [{ slug: "a" }] });
    const data = await apiFetch<{ sites: { slug: string }[] }>("/api/sites");
    expect(data.sites[0].slug).toBe("a");
  });

  it("maps 401 to ApiError AND clears the stored token", async () => {
    setAdminToken("bad");
    mockFetch(401, { error: "unauthorized" });
    await expect(apiFetch("/api/sites")).rejects.toBeInstanceOf(ApiError);
    expect(getAdminToken()).toBeNull();
  });

  it("maps other non-2xx to ApiError with the server error message + status", async () => {
    mockFetch(409, { error: "slug already in use" });
    try {
      await apiFetch("/api/sites", { method: "POST", body: {} });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe("slug already in use");
    }
  });
});
