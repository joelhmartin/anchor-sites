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
});
