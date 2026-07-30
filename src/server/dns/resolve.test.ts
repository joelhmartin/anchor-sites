import { describe, it, expect } from "vitest";
import { resolveDnsProvider } from "./resolve.js";

const GD = { GODADDY_API_KEY: "k", GODADDY_API_SECRET: "s" } as NodeJS.ProcessEnv;
const KI = { KINSTA_API_KEY: "k", KINSTA_COMPANY_ID: "c" } as NodeJS.ProcessEnv;

describe("resolveDnsProvider", () => {
  it("defaults to godaddy when only godaddy creds are present", () => {
    expect(resolveDnsProvider(GD).id).toBe("godaddy");
  });
  it("defaults to manual when no creds are present", () => {
    expect(resolveDnsProvider({} as NodeJS.ProcessEnv).id).toBe("manual");
  });
  it("honors DNS_PROVIDER=manual even with creds present", () => {
    expect(resolveDnsProvider({ ...GD, DNS_PROVIDER: "manual" }).id).toBe("manual");
  });
  it("honors DNS_PROVIDER=cloud-dns", () => {
    expect(resolveDnsProvider({ DNS_PROVIDER: "cloud-dns" } as NodeJS.ProcessEnv).id).toBe("cloud-dns");
  });
  it("throws when DNS_PROVIDER=godaddy but creds are missing", () => {
    expect(() => resolveDnsProvider({ DNS_PROVIDER: "godaddy" } as NodeJS.ProcessEnv)).toThrow(
      /GODADDY_API_KEY/,
    );
  });
  it("throws on an unrecognized DNS_PROVIDER value", () => {
    expect(() => resolveDnsProvider({ ...GD, DNS_PROVIDER: "invalid-provider" } as NodeJS.ProcessEnv)).toThrow(
      /Unknown DNS_PROVIDER/,
    );
  });

  it("honors DNS_PROVIDER=godaddy when creds are present", () => {
    expect(resolveDnsProvider({ ...GD, DNS_PROVIDER: "godaddy" }).id).toBe("godaddy");
  });

  // Kinsta precedence (Task D1): anchorcorps.com's primary zone lives on
  // Kinsta DNS, so its default-mode precedence beats GoDaddy.
  it("defaults to kinsta when only kinsta creds are present", () => {
    expect(resolveDnsProvider(KI).id).toBe("kinsta");
  });
  it("defaults to kinsta over godaddy when both sets of creds are present", () => {
    expect(resolveDnsProvider({ ...GD, ...KI }).id).toBe("kinsta");
  });
  it("honors DNS_PROVIDER=kinsta when creds are present", () => {
    expect(resolveDnsProvider({ ...GD, ...KI, DNS_PROVIDER: "kinsta" }).id).toBe("kinsta");
  });
  it("honors DNS_PROVIDER=godaddy even when kinsta creds are also present", () => {
    expect(resolveDnsProvider({ ...GD, ...KI, DNS_PROVIDER: "godaddy" }).id).toBe("godaddy");
  });
  it("throws when DNS_PROVIDER=kinsta but creds are missing", () => {
    expect(() => resolveDnsProvider({ DNS_PROVIDER: "kinsta" } as NodeJS.ProcessEnv)).toThrow(
      /KINSTA_API_KEY/,
    );
  });
});
