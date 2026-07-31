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

  it("fix round 1, item 3: evicts a stale cached domain_id on a 404 from dns-records and retries once against a freshly resolved id", async () => {
    // Simulates the domain entry being deleted + re-added on Kinsta's side
    // (new domain_id, same zone name) AFTER we've already cached the old id.
    let domainsListCalls = 0;
    let abcRecordsGetCalls = 0;
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) {
        domainsListCalls += 1;
        const id = domainsListCalls === 1 ? "domain-abc" : "domain-xyz";
        return {
          status: 200,
          body: { company: { domains: [{ id, name: "anchorcorps.com", site_id: null, is_active: true }] } },
        };
      }
      if (url.includes("/domains/domain-abc/dns-records")) {
        if (init?.method === "POST") {
          return { status: 202, body: { operation_id: "op-1", message: "ok", status: 202 } };
        }
        abcRecordsGetCalls += 1;
        // First ensureRecord call's list succeeds (empty zone); the SECOND
        // call's list 404s — the cached domain_id has gone stale.
        if (abcRecordsGetCalls === 1) return { status: 200, body: { domain: { dns_records: [] } } };
        return { status: 404, body: { message: "domain not found" } };
      }
      if (url.includes("/domains/domain-xyz/dns-records")) {
        if (init?.method === "POST") {
          return { status: 202, body: { operation_id: "op-2", message: "ok", status: 202 } };
        }
        return { status: 200, body: { domain: { dns_records: [] } } };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KinstaDnsProvider(CFG);

    // Call 1: resolves + caches domain-abc, creates the record against it.
    const first = await provider.ensureRecord("anchorcorps.com", record);
    expect(first).toBe("created");
    expect(domainsListCalls).toBe(1);

    // Call 2: cached domain-abc is used first (no new domains-list call
    // yet), its dns-records list 404s, so it's evicted and re-resolved —
    // landing on domain-xyz — and the write goes to domain-xyz's path.
    const second = await provider.ensureRecord("anchorcorps.com", record);
    expect(second).toBe("created");
    expect(domainsListCalls).toBe(2);

    const postCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0][0]).toBe("https://api.kinsta.test/v2/domains/domain-abc/dns-records");
    expect(postCalls[1][0]).toBe("https://api.kinsta.test/v2/domains/domain-xyz/dns-records");
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

  it("fix round 1, item 2: a zone-wide wildcard record does NOT satisfy a literal per-site hostname — issues a CREATE", async () => {
    // Locks in actual behavior: findRecord matches by exact (type, name), so
    // `*.sites.anchorcorps.com` in the zone is a completely different `name`
    // from `foo.sites.anchorcorps.com` — they never match, even though the
    // wildcard would resolve the hostname in DNS itself. Every new site's
    // first provision run therefore issues a real POST, not a no-op.
    const wildcardOnlyZone = {
      status: 200,
      body: {
        domain: {
          dns_records: [
            {
              type: "CNAME",
              name: "*.sites.anchorcorps.com",
              ttl: 3600,
              resource_records: [{ value: "ghs.googlehosted.com" }],
            },
          ],
        },
      },
    };
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "POST") return { status: 202, body: { operation_id: "op-w", message: "ok", status: 202 } };
      return wildcardOnlyZone;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KinstaDnsProvider(CFG).ensureRecord("anchorcorps.com", {
      name: "foo.sites.anchorcorps.com.",
      type: "CNAME",
      data: "ghs.googlehosted.com.",
    });

    expect(result).toBe("created");
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      type: "CNAME",
      name: "foo.sites.anchorcorps.com",
      ttl: 3600,
      resource_records: [{ value: "ghs.googlehosted.com" }],
    });
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

  // D1003: «ensureRecord with a changed value must converge on exactly the
  // desired value». The old PUT sent new_resource_records only — APPENDING
  // the new value while the stale one persisted (an invalid multi-value
  // CNAME, with the stale target still served).
  it("PUTs new_resource_records AND removed_resource_records (converge) when a same-name/type record exists with a different value", async () => {
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
      removed_resource_records: [{ value: "some-other-target.example.com" }],
    });
  });

  it("converges multiple stale values away in one PUT", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "PUT") return { status: 202, body: { operation_id: "op-2b", message: "ok", status: 202 } };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "CNAME",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [
                  { value: "stale-one.example.com" },
                  { value: "stale-two.example.com" },
                ],
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
      removed_resource_records: [
        { value: "stale-one.example.com" },
        { value: "stale-two.example.com" },
      ],
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

  // Same law as D1022 (GoDaddy): remove exactly the record we created.
  // Kinsta's DELETE addresses the whole (type, name) recordset — with
  // co-resident values it must PUT removed_resource_records instead.
  it("PUTs removed_resource_records (never DELETE) when co-resident values exist", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/domains?company=")) return { status: 200, body: domainsListBody };
      if (init?.method === "PUT") return { status: 202, body: { operation_id: "op-4", message: "ok", status: 202 } };
      return {
        status: 200,
        body: {
          domain: {
            dns_records: [
              {
                type: "A",
                name: "muldoon-dental.sites.anchorcorps.com",
                ttl: 3600,
                resource_records: [{ value: "1.1.1.1" }, { value: "2.2.2.2" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await new KinstaDnsProvider(CFG).removeRecord("anchorcorps.com", {
      name: "muldoon-dental.sites.anchorcorps.com.",
      type: "A",
      data: "1.1.1.1",
    });

    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "DELETE")).toBe(false);
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect(put).toBeDefined();
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({
      type: "A",
      name: "muldoon-dental.sites.anchorcorps.com",
      removed_resource_records: [{ value: "1.1.1.1" }],
    });
  });

  it("no-ops when the recordset exists but does not contain the target value", async () => {
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
                resource_records: [{ value: "someone-elses-target.example.com" }],
              },
            ],
          },
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await new KinstaDnsProvider(CFG).removeRecord("anchorcorps.com", record);

    expect(
      fetchMock.mock.calls.some((c) =>
        ["PUT", "DELETE"].includes(((c[1] as RequestInit)?.method ?? "GET") as string),
      ),
    ).toBe(false);
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
