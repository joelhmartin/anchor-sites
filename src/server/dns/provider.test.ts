import { describe, it, expect } from "vitest";
import { relativeName, toFqdn, normalizeData } from "./provider.js";

describe("relativeName", () => {
  it("strips the zone suffix to a relative label", () => {
    expect(relativeName("muldoon-dental.sites.anchorcorps.com", "anchorcorps.com")).toBe(
      "muldoon-dental.sites",
    );
  });
  it("tolerates trailing dots and case", () => {
    expect(relativeName("Muldoon.SITES.anchorcorps.com.", "anchorcorps.com.")).toBe(
      "muldoon.sites",
    );
  });
  it("returns @ for the apex itself", () => {
    expect(relativeName("anchorcorps.com", "anchorcorps.com")).toBe("@");
  });
  it("throws when the fqdn is not within the zone", () => {
    expect(() => relativeName("foo.example.com", "anchorcorps.com")).toThrow(
      /not within zone/,
    );
  });
});

describe("toFqdn", () => {
  it("joins a relative label onto the zone", () => {
    expect(toFqdn("muldoon-dental.sites", "anchorcorps.com")).toBe(
      "muldoon-dental.sites.anchorcorps.com",
    );
  });
  it("maps @ to the apex", () => {
    expect(toFqdn("@", "anchorcorps.com")).toBe("anchorcorps.com");
  });
});

describe("normalizeData", () => {
  it("drops the trailing dot and lowercases CNAME targets", () => {
    expect(normalizeData("CNAME", "GHS.googlehosted.com.")).toBe("ghs.googlehosted.com");
  });
  it("leaves non-CNAME data untouched (besides trim)", () => {
    expect(normalizeData("TXT", " hello ")).toBe("hello");
  });
});
