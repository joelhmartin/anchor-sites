import { afterEach, describe, expect, it } from "vitest";
import { isAdminHost, studioHost } from "./admin-host.js";

describe("isAdminHost (P4-T4.1 / D-032)", () => {
  const orig = process.env.STUDIO_HOST;
  afterEach(() => {
    if (orig === undefined) delete process.env.STUDIO_HOST;
    else process.env.STUDIO_HOST = orig;
  });

  it("matches the default studio.anchorcorps.com", () => {
    delete process.env.STUDIO_HOST;
    expect(isAdminHost("studio.anchorcorps.com")).toBe(true);
  });

  it("matches studio.localhost for local dev", () => {
    expect(isAdminHost("studio.localhost")).toBe(true);
  });

  it("is port-insensitive", () => {
    expect(isAdminHost("studio.localhost:3000")).toBe(true);
    expect(isAdminHost("studio.anchorcorps.com:443")).toBe(true);
  });

  it("rejects tenant hosts under sites.anchorcorps.com", () => {
    expect(isAdminHost("muldoon-dental.sites.anchorcorps.com")).toBe(false);
    expect(isAdminHost("demo-site.sites.anchorcorps.com")).toBe(false);
    // A tenant literally named "studio" is still NOT the admin host.
    expect(isAdminHost("studio.sites.anchorcorps.com")).toBe(false);
  });

  it("rejects the apex + unrelated hosts", () => {
    expect(isAdminHost("anchorcorps.com")).toBe(false);
    expect(isAdminHost("www.anchorcorps.com")).toBe(false);
    expect(isAdminHost("example.com")).toBe(false);
    expect(isAdminHost("")).toBe(false);
    expect(isAdminHost(undefined)).toBe(false);
    expect(isAdminHost(null)).toBe(false);
  });

  it("honors a STUDIO_HOST override", () => {
    process.env.STUDIO_HOST = "studio.staging.anchorcorps.com";
    expect(isAdminHost("studio.staging.anchorcorps.com")).toBe(true);
    expect(isAdminHost("studio.anchorcorps.com")).toBe(false);
    expect(studioHost()).toBe("studio.staging.anchorcorps.com");
  });
});
