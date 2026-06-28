import { describe, it, expect } from "vitest";
import { resolveDnsProvider } from "./resolve.js";

const GD = { GODADDY_API_KEY: "k", GODADDY_API_SECRET: "s" } as NodeJS.ProcessEnv;

describe("resolveDnsProvider", () => {
  it("defaults to godaddy when creds are present", () => {
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
});
