import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KinstaClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const client = new KinstaClient({
    apiKey: "test-key",
    companyId: "co-uuid",
    baseUrl: "https://api.kinsta.com/v2",
  });

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listDomains hits the company-scoped endpoint with Bearer auth", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        company: { domains: [{ id: "d1", name: "anchorcorps.com", site_id: null, is_active: true }] },
      }),
    );
    const list = await client.listDomains();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("anchorcorps.com");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kinsta.com/v2/domains?company=co-uuid");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  it("getDomainIdByName matches case-insensitively + throws on miss", async () => {
    const fixture = jsonResponse({
      company: {
        domains: [
          { id: "d1", name: "Anchorcorps.com", site_id: null, is_active: true },
          { id: "d2", name: "OTHER.com", site_id: null, is_active: true },
        ],
      },
    });
    fetchSpy.mockResolvedValueOnce(fixture.clone());
    expect(await client.getDomainIdByName("ANCHORCORPS.COM")).toBe("d1");

    fetchSpy.mockResolvedValueOnce(fixture.clone());
    await expect(client.getDomainIdByName("missing.com")).rejects.toThrow(/no Kinsta domain/i);
  });

  it("createDnsRecord rejects relative names BEFORE hitting the API", async () => {
    await expect(
      client.createDnsRecord("d1", {
        name: "muldoon.sites",
        type: "CNAME",
        resource_records: [{ value: "ghs.googlehosted.com." }],
      }),
    ).rejects.toThrow(/FQDN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("createDnsRecord posts FQDN + returns operation_id", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        status: 202,
        message: "in progress",
        operation_id: "op-123",
      }),
    );
    const opId = await client.createDnsRecord("d1", {
      name: "muldoon-dental.sites.anchorcorps.com",
      type: "CNAME",
      resource_records: [{ value: "ghs.googlehosted.com." }],
    });
    expect(opId).toBe("op-123");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kinsta.com/v2/domains/d1/dns-records");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type: "CNAME",
      name: "muldoon-dental.sites.anchorcorps.com",
      ttl: 3600,
      resource_records: [{ value: "ghs.googlehosted.com." }],
    });
  });

  it("pollOperation resolves on success (status 200, no 'in progress')", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ status: 200, message: "successfully finished", data: {} }),
    );
    const op = await client.pollOperation("op-x", { intervalMs: 5 });
    expect(op.status).toBe(200);
  });

  it("pollOperation retries while 'in progress' then succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ status: 202, message: "Creating ... in progress" }))
      .mockResolvedValueOnce(jsonResponse({ status: 202, message: "Creating ... in progress" }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, message: "successfully finished" }));
    const op = await client.pollOperation("op-x", { intervalMs: 5, timeoutMs: 5_000 });
    expect(op.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("pollOperation throws when Kinsta reports failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        status: 500,
        message: "Operation failed",
        data: { status: 500, message: "RRSet with DNS name foo. is not permitted in zone bar." },
      }),
    );
    await expect(client.pollOperation("op-y", { intervalMs: 5 })).rejects.toThrow(
      /not permitted in zone/i,
    );
  });

  it("addCname appends trailing dot to target if missing", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ status: 202, message: "in progress", operation_id: "op-cn" }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, message: "successfully finished" }));
    await client.addCname("d1", "muldoon-dental.sites.anchorcorps.com", "ghs.googlehosted.com");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const posted = JSON.parse(init.body as string);
    expect(posted.resource_records[0].value).toBe("ghs.googlehosted.com.");
  });

  it("propagates non-2xx HTTP errors as exceptions", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(client.listDomains()).rejects.toThrow(/kinsta 403/);
  });
});
