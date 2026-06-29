import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoDaddyDnsProvider, getGoDaddyConfig } from "./godaddy.js";

const CFG = { apiKey: "k", apiSecret: "s", baseUrl: "https://api.godaddy.test" };
const record = {
  name: "muldoon-dental.sites.anchorcorps.com.",
  type: "CNAME",
  data: "ghs.googlehosted.com.",
};

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    } as Response;
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("getGoDaddyConfig", () => {
  it("returns null when creds are absent", () => {
    expect(getGoDaddyConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("reads key/secret and defaults the base url", () => {
    const cfg = getGoDaddyConfig({ GODADDY_API_KEY: "k", GODADDY_API_SECRET: "s" } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ apiKey: "k", apiSecret: "s", baseUrl: "https://api.godaddy.com" });
  });
});

describe("GoDaddyDnsProvider.ensureRecord", () => {
  it("PUTs the relative record and returns 'created' when absent", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "PUT") return { status: 200, body: undefined };
      return { status: 200, body: [] }; // GET: no existing record
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("created");
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect(put[0]).toBe(
      "https://api.godaddy.test/v1/domains/anchorcorps.com/records/CNAME/muldoon-dental.sites",
    );
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual([
      { data: "ghs.googlehosted.com", ttl: 3600 },
    ]);
    // Auth header present but never the only assertion — confirm shape:
    expect((put[1] as RequestInit).headers).toMatchObject({ Authorization: "sso-key k:s" });
  });

  it("returns 'exists' and does not PUT when the record already matches", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: [{ data: "ghs.googlehosted.com.", ttl: 3600 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("exists");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(false);
  });
});

describe("GoDaddyDnsProvider.verifyRecord", () => {
  it("is true when GoDaddy returns the matching value", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 200, body: [{ data: "ghs.googlehosted.com" }] })));
    expect(await new GoDaddyDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(true);
  });
  it("is false on a 404 (no such record)", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 404, body: { code: "NOT_FOUND" } })));
    expect(await new GoDaddyDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(false);
  });
});

describe("GoDaddyDnsProvider.removeRecord", () => {
  it("issues a DELETE to the relative record path", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    await new GoDaddyDnsProvider(CFG).removeRecord("anchorcorps.com", record);

    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE")!;
    expect(del).toBeDefined();
    expect(del[0]).toBe(
      "https://api.godaddy.test/v1/domains/anchorcorps.com/records/CNAME/muldoon-dental.sites",
    );
  });

  it("resolves without throwing on a 404 (idempotent removal)", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 404, body: { code: "NOT_FOUND" } })));
    await expect(
      new GoDaddyDnsProvider(CFG).removeRecord("anchorcorps.com", record),
    ).resolves.toBeUndefined();
  });
});

describe("GoDaddyDnsProvider error handling", () => {
  it("throws on a non-404 error without leaking the secret", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 500, body: { message: "boom" } })));
    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toThrow(/GoDaddy 500/);
    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.not.toThrow(/sso-key/);
  });

  it("does not leak the secret on a write-path (PUT) error", async () => {
    // GET finds no record so the code proceeds to PUT, which then fails.
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) =>
        init?.method === "PUT"
          ? { status: 500, body: { message: "boom" } }
          : { status: 200, body: [] },
      ),
    );

    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toThrow(/GoDaddy 500/);

    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toEqual(
      expect.objectContaining({ message: expect.not.stringContaining("sso-key") }),
    );
  });
});
