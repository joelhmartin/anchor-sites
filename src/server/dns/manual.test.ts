import { describe, it, expect, vi } from "vitest";
import { ManualDnsProvider, type DnsResolver } from "./manual.js";

const record = {
  name: "muldoon-dental.sites.anchorcorps.com.",
  type: "CNAME",
  data: "ghs.googlehosted.com.",
};

function resolverWith(partial: Partial<DnsResolver>): DnsResolver {
  return {
    resolveCname: vi.fn(async () => { throw new Error("ENOTFOUND"); }),
    resolve4: vi.fn(async () => { throw new Error("ENOTFOUND"); }),
    resolveTxt: vi.fn(async () => { throw new Error("ENOTFOUND"); }),
    ...partial,
  };
}

describe("ManualDnsProvider", () => {
  it("never writes — ensureRecord returns 'external'", async () => {
    const p = new ManualDnsProvider(resolverWith({}));
    expect(await p.ensureRecord("anchorcorps.com", record)).toBe("external");
  });

  it("removeRecord is a no-op", async () => {
    const p = new ManualDnsProvider(resolverWith({}));
    await expect(p.removeRecord("anchorcorps.com", record)).resolves.toBeUndefined();
  });

  it("verifyRecord is true when a live CNAME lookup matches", async () => {
    const p = new ManualDnsProvider(
      resolverWith({ resolveCname: vi.fn(async () => ["ghs.googlehosted.com"]) }),
    );
    expect(await p.verifyRecord("anchorcorps.com", record)).toBe(true);
  });

  it("verifyRecord is false when the lookup misses or errors", async () => {
    const p = new ManualDnsProvider(resolverWith({}));
    expect(await p.verifyRecord("anchorcorps.com", record)).toBe(false);
  });

  it("verifyRecord is false when the CNAME resolves but does not match", async () => {
    const p = new ManualDnsProvider(
      resolverWith({ resolveCname: vi.fn(async () => ["other.example.com"]) }),
    );
    expect(await p.verifyRecord("anchorcorps.com", record)).toBe(false);
  });

  it("verifyRecord is true when an A lookup includes the address", async () => {
    const aRecord = { name: "muldoon-dental.sites.anchorcorps.com.", type: "A", data: "203.0.113.10" };
    const p = new ManualDnsProvider(resolverWith({ resolve4: vi.fn(async () => ["203.0.113.10"]) }));
    expect(await p.verifyRecord("anchorcorps.com", aRecord)).toBe(true);
  });

  it("verifyRecord is true when a TXT lookup joins to the expected value", async () => {
    const txtRecord = { name: "muldoon-dental.sites.anchorcorps.com.", type: "TXT", data: "google-site-verification=abc123" };
    const p = new ManualDnsProvider(
      resolverWith({ resolveTxt: vi.fn(async () => [["google-site-verification=", "abc123"]]) }),
    );
    expect(await p.verifyRecord("anchorcorps.com", txtRecord)).toBe(true);
  });
});
