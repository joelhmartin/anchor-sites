import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDomainConfig,
  hostnameForSlug,
  isUnderSitesDomain,
  subdomainPattern,
} from "./domain.js";

describe("domain config", () => {
  const savedBase = process.env.SITES_DOMAIN_BASE;
  const savedReg = process.env.SITES_DOMAIN_REGISTRABLE;

  beforeEach(() => {
    delete process.env.SITES_DOMAIN_BASE;
    delete process.env.SITES_DOMAIN_REGISTRABLE;
  });

  afterEach(() => {
    if (savedBase === undefined) delete process.env.SITES_DOMAIN_BASE;
    else process.env.SITES_DOMAIN_BASE = savedBase;
    if (savedReg === undefined) delete process.env.SITES_DOMAIN_REGISTRABLE;
    else process.env.SITES_DOMAIN_REGISTRABLE = savedReg;
  });

  it("defaults to sites.anchorcorps.com / anchorcorps.com", () => {
    const c = getDomainConfig();
    expect(c.base).toBe("sites.anchorcorps.com");
    expect(c.registrable).toBe("anchorcorps.com");
  });

  it("env overrides land", () => {
    process.env.SITES_DOMAIN_BASE = "tenants.acmegroup.com";
    const c = getDomainConfig();
    expect(c.base).toBe("tenants.acmegroup.com");
    expect(c.registrable).toBe("acmegroup.com");
  });

  it("explicit registrable wins (e.g. ccTLDs like .co.uk)", () => {
    process.env.SITES_DOMAIN_BASE = "tenants.example.co.uk";
    process.env.SITES_DOMAIN_REGISTRABLE = "example.co.uk";
    const c = getDomainConfig();
    expect(c.registrable).toBe("example.co.uk");
  });

  it("strips stray leading/trailing dots + lowercases", () => {
    process.env.SITES_DOMAIN_BASE = ".SITES.ANCHORCORPS.COM.";
    expect(getDomainConfig().base).toBe("sites.anchorcorps.com");
  });

  describe("hostnameForSlug", () => {
    it("composes <slug>.<base>", () => {
      expect(hostnameForSlug("muldoon-dental")).toBe("muldoon-dental.sites.anchorcorps.com");
    });

    it("lowercases the slug", () => {
      expect(hostnameForSlug("Muldoon-DENTAL")).toBe("muldoon-dental.sites.anchorcorps.com");
    });

    it("rejects invalid slugs", () => {
      expect(() => hostnameForSlug("")).toThrow(/invalid slug/i);
      expect(() => hostnameForSlug("-leading")).toThrow(/invalid slug/i);
      expect(() => hostnameForSlug("trailing-")).toThrow(/invalid slug/i);
      expect(() => hostnameForSlug("has.dot")).toThrow(/invalid slug/i);
      expect(() => hostnameForSlug("has space")).toThrow(/invalid slug/i);
    });
  });

  describe("subdomainPattern", () => {
    it("matches subdomains of the configured base + captures the label", () => {
      const re = subdomainPattern();
      expect("muldoon-dental.sites.anchorcorps.com".match(re)?.[1]).toBe("muldoon-dental");
      expect("demo-site.sites.anchorcorps.com".match(re)?.[1]).toBe("demo-site");
    });

    it("does NOT match unrelated subdomains under the same apex", () => {
      const re = subdomainPattern();
      expect("mail.anchorcorps.com".match(re)).toBeNull();
      expect("www.anchorcorps.com".match(re)).toBeNull();
      expect("hub.anchorcorps.com".match(re)).toBeNull();
    });

    it("does NOT match a deeper subdomain (no nested labels)", () => {
      const re = subdomainPattern();
      expect("a.b.sites.anchorcorps.com".match(re)).toBeNull();
    });

    it("respects env override", () => {
      process.env.SITES_DOMAIN_BASE = "tenants.example.com";
      const re = subdomainPattern();
      expect("acme.tenants.example.com".match(re)?.[1]).toBe("acme");
      expect("acme.sites.anchorcorps.com".match(re)).toBeNull();
    });
  });

  describe("isUnderSitesDomain", () => {
    it("returns true/false correctly", () => {
      expect(isUnderSitesDomain("foo.sites.anchorcorps.com")).toBe(true);
      expect(isUnderSitesDomain("foo.anchorcorps.com")).toBe(false);
      expect(isUnderSitesDomain("foo.localhost")).toBe(false);
    });
  });
});
