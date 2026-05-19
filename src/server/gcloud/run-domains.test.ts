import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRunDomainsClient } from "./run-domains.js";
import { __clearTokenCacheForTests } from "./access-token.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CloudRunDomainsClient", () => {
  const client = new CloudRunDomainsClient({
    projectId: "proj-x",
    region: "us-central1",
    serviceName: "anchor-sites",
  });
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalK = process.env.K_SERVICE;

  beforeEach(() => {
    __clearTokenCacheForTests();
    // Pretend we're on Cloud Run so getGcpAccessToken hits the metadata
    // server (which fetchSpy will mock) instead of shelling out to gcloud.
    process.env.K_SERVICE = "anchor-sites";
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    if (originalK === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalK;
    vi.unstubAllGlobals();
  });

  const tokenResponse = () =>
    jsonResponse({ access_token: "stub-token", expires_in: 3600 });

  it("create POSTs to the regional Knative endpoint with Bearer auth", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          apiVersion: "domains.cloudrun.com/v1",
          kind: "DomainMapping",
          metadata: { name: "muldoon-dental.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites", certificateMode: "AUTOMATIC" },
        }),
      );

    const m = await client.create("muldoon-dental.sites.anchorcorps.com");
    expect(m.metadata.name).toBe("muldoon-dental.sites.anchorcorps.com");

    // First call: metadata-server token. Second call: Cloud Run POST.
    const [postUrl, postInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(postUrl).toBe(
      "https://us-central1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/proj-x/domainmappings",
    );
    expect(postInit.method).toBe("POST");
    const headers = postInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer stub-token");
    const body = JSON.parse(postInit.body as string);
    expect(body.metadata.name).toBe("muldoon-dental.sites.anchorcorps.com");
    expect(body.spec.routeName).toBe("anchor-sites");
    expect(body.spec.certificateMode).toBe("AUTOMATIC");
  });

  it("get returns null on 404", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const m = await client.get("missing.sites.anchorcorps.com");
    expect(m).toBeNull();
  });

  it("get returns the mapping when present", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          apiVersion: "domains.cloudrun.com/v1",
          kind: "DomainMapping",
          metadata: { name: "demo-site.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites" },
          status: {
            conditions: [
              { type: "Ready", status: "True" },
              { type: "CertificateProvisioned", status: "True" },
            ],
            resourceRecords: [
              { name: "demo-site.sites", rrdata: "ghs.googlehosted.com.", type: "CNAME" },
            ],
          },
        }),
      );
    const m = await client.get("demo-site.sites.anchorcorps.com");
    expect(m?.status?.conditions?.[0]?.type).toBe("Ready");
  });

  it("createIfMissing skips create when mapping exists", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          apiVersion: "domains.cloudrun.com/v1",
          kind: "DomainMapping",
          metadata: { name: "muldoon-dental.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites" },
        }),
      );
    await client.createIfMissing("muldoon-dental.sites.anchorcorps.com");
    // Token + GET. No POST.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1] as [string, RequestInit])[1].method ?? "GET").toBe("GET");
  });

  it("waitForReady polls until both Ready + CertificateProvisioned are True", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          apiVersion: "domains.cloudrun.com/v1",
          kind: "DomainMapping",
          metadata: { name: "x.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites" },
          status: {
            conditions: [
              { type: "Ready", status: "Unknown" },
              { type: "CertificateProvisioned", status: "Unknown" },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          apiVersion: "domains.cloudrun.com/v1",
          kind: "DomainMapping",
          metadata: { name: "x.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites" },
          status: {
            conditions: [
              { type: "Ready", status: "True" },
              { type: "CertificateProvisioned", status: "True" },
            ],
          },
        }),
      );

    const m = await client.waitForReady("x.sites.anchorcorps.com", {
      intervalMs: 5,
      timeoutMs: 5_000,
    });
    expect(m.status?.conditions?.every((c) => c.status === "True")).toBe(true);
  });

  it("waitForReady throws when timeout elapses", async () => {
    // Token + an unending sequence of not-ready responses.
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("/instance/service-accounts/")) return tokenResponse();
      return jsonResponse({
        metadata: { name: "y.sites.anchorcorps.com", namespace: "proj-x" },
        spec: { routeName: "anchor-sites" },
        status: { conditions: [{ type: "Ready", status: "Unknown" }] },
      });
    });
    await expect(
      client.waitForReady("y.sites.anchorcorps.com", { intervalMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/not ready/i);
  });

  it("getRequiredDnsRecords returns Cloud Run's expected records", async () => {
    fetchSpy
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          metadata: { name: "z.sites.anchorcorps.com", namespace: "proj-x" },
          spec: { routeName: "anchor-sites" },
          status: {
            resourceRecords: [
              { name: "z.sites", rrdata: "ghs.googlehosted.com.", type: "CNAME" },
            ],
          },
        }),
      );
    const rrs = await client.getRequiredDnsRecords("z.sites.anchorcorps.com");
    expect(rrs[0]).toEqual({ name: "z.sites", rrdata: "ghs.googlehosted.com.", type: "CNAME" });
  });
});
