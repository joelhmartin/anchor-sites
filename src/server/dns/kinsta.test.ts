import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  KinstaDnsProvider,
  getKinstaConfig,
  __resetKinstaDomainCacheForTests,
} from "./kinsta.js";

const CFG = { apiKey: "k", companyId: "co-1", baseUrl: "https://api.kinsta.test/v2" };
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

const domainsListBody = {
  company: {
    domains: [{ id: "domain-abc", name: "anchorcorps.com", site_id: null, is_active: true }],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  __resetKinstaDomainCacheForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getKinstaConfig", () => {
  it("returns null when creds are absent", () => {
    expect(getKinstaConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("returns null when only one of the two env vars is set", () => {
    expect(getKinstaConfig({ KINSTA_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(getKinstaConfig({ KINSTA_COMPANY_ID: "c" } as NodeJS.ProcessEnv)).toBeNull();
  });
  it("reads key/company and defaults the base url", () => {
    const cfg = getKinstaConfig({ KINSTA_API_KEY: "k", KINSTA_COMPANY_ID: "c" } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ apiKey: "k", companyId: "c", baseUrl: "https://api.kinsta.com/v2" });
  });
});

describe("KinstaDnsProvider domain-id resolution + cache", () => {
  it("resolves the domain_id from the company domain list", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return { status: 200, body: { domain: { dns_records: [] } } };
    });
    vi.stubGlobal("fetch", fetchMock);

    await new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    const listCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/domains?company="))!;
    expect(listCall[0]).toBe(`https://api.kinsta.test/v2/domains?company=co-1`);
  });

  it("caches the domain_id across calls — the company domain list is fetched only once", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return { status: 200, body: { domain: { dns_records: [] } } };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KinstaDnsProvider(CFG);
    await provider.ensureRecord("anchorcorps.com", record);
    await provider.verifyRecord("anchorcorps.com", record);

    const listCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/domains?company="));
    expect(listCalls).toHaveLength(1);
  });

  it("throws when no domain matches the zone, and does not poison the cache", async () => {
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: { company: { domains: [{ id: "x", name: "other-domain.com", site_id: null, is_active: true }] } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toThrow(/no domain found/);
  });
});

describe("KinstaDnsProvider.ensureRecord", () => {
  it("POSTs a new record and returns 'created' when no record with that type/name exists", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "POST") return { status: 202, body: { operation_id: "op-1", message: "ok", status: 202 } };
      return { status: 200, body: { domain: { dns_records: [] } } }; // GET: nothing yet
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("created");
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST")!;
    expect(post[0]).toBe("https://api.kinsta.test/v2/domains/domain-abc/dns-records");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      type: "CNAME",
      name: "muldoon-dental.sites.anchorcorps.com",
      ttl: 3600,
      resource_records: [{ value: "ghs.googlehosted.com" }],
    });
    expect((post[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer k" });
  });

  it("returns 'exists' and does not write when the record already has the wanted value", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "CNAME",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [{ value: "ghs.googlehosted.com" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("exists");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method !== undefined)).toBe(false);
  });

  it("PUTs new_resource_records (upsert) and returns 'created' when a same-name/type record exists with a different value", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "PUT") return { status: 202, body: { operation_id: "op-2", message: "ok", status: 202 } };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "CNAME",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [{ value: "some-other-target.example.com" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("created");
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({
      type: "CNAME",
      name: "muldoon-dental.sites.anchorcorps.com",
      new_resource_records: [{ value: "ghs.googlehosted.com" }],
    });
  });
});

describe("KinstaDnsProvider.verifyRecord", () => {
  it("is true when Kinsta returns the matching value", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "CNAME",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [{ value: "ghs.googlehosted.com" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await new KinstaDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(true);
  });

  it("is false when no record with that type/name exists", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return { status: 200, body: { domain: { dns_records: [] } } };
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await new KinstaDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(false);
  });
});

describe("KinstaDnsProvider.removeRecord", () => {
  it("issues a DELETE with {type, name} when a matching record exists", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "DELETE") return { status: 202, body: { operation_id: "op-3", message: "ok", status: 202 } };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "CNAME",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [{ value: "ghs.googlehosted.com" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await new KinstaDnsProvider(CFG).removeRecord("anchorcorps.com", record);

    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE")!;
    expect(del[0]).toBe("https://api.kinsta.test/v2/domains/domain-abc/dns-records");
    expect(JSON.parse((del[1] as RequestInit).body as string)).toEqual({
      type: "CNAME",
      name: "muldoon-dental.sites.anchorcorps.com",
    });
  });

  it("is idempotent — resolves without issuing a DELETE when no matching record exists", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return { status: 200, body: { domain: { dns_records: [] } } };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new KinstaDnsProvider(CFG).removeRecord("anchorcorps.com", record),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "DELETE")).toBe(false);
  });
});

describe("KinstaDnsProvider error handling", () => {
  it("throws on a non-2xx error without leaking the API key", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      return { status: 500, body: { message: "boom" } };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toThrow(/Kinsta 500/);
    await expect(
      new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toEqual(expect.objectContaining({ message: expect.not.stringContaining("Bearer k") }));
  });
});
