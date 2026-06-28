# gcloud-hosted sites, pluggable DNS, remove Kinsta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Kinsta reference and replace the provisioning DNS step with a pluggable `DnsProvider` (GoDaddy + manual now, Cloud DNS interface-ready), driven off the records Cloud Run already reports.

**Architecture:** A new `src/server/dns/` module defines a small `DnsProvider` interface and three implementations. The provisioning orchestrator creates the Cloud Run domain mapping first, asks Cloud Run which DNS records the domain needs, then applies them through the resolved provider (idempotent). Kinsta's client, env vars, and doc references are deleted.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node `fetch`, `node:dns/promises`, Vitest, Express, Postgres (`pg`).

## Global Constraints

- ESM throughout; **import specifiers end in `.js`** even for `.ts` sources.
- No live network in tests — mock `fetch` and DNS resolution. (Mirrors the existing "no live Google round-trip" convention.)
- Secrets are never logged or echoed. The GoDaddy auth header (`sso-key KEY:SECRET`) must never appear in error messages, logs, or test output.
- Env-driven graceful degradation, mirroring `resolveStudioAuthMode`: no DNS creds present → `manual` mode, never a crash.
- Zone written to is the **registrable apex** from `getDomainConfig().registrable` (default `anchorcorps.com`).
- **Acceptance for the whole plan:** `grep -rli kinsta . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` returns ONLY the two design docs (`docs/superpowers/specs/2026-06-28-gcloud-dns-remove-kinsta-design.md` and this plan).
- Commit after each task.

---

## File Structure

- `src/server/dns/provider.ts` — interface, shared types, pure name/data helpers (Task 1)
- `src/server/dns/godaddy.ts` — GoDaddy API provider (Task 2)
- `src/server/dns/manual.ts` — lookup-verify / external provider (Task 3)
- `src/server/dns/cloud-dns.ts` — interface-ready stub (Task 4)
- `src/server/dns/resolve.ts` — env-driven provider selection (Task 4)
- `src/server/provisioning/orchestrator.ts` — rewrite DNS step, drop Kinsta (Task 5)
- `src/server/kinsta/` — **deleted** (Task 6)
- `scripts/provision-site.ts`, `src/server/routes/admin-pages.ts`, `src/config/domain.ts` — comment/env fixups (Task 6)
- docs + planning `.md` — scrub (Task 7)

---

### Task 1: DnsProvider interface + shared helpers

**Files:**
- Create: `src/server/dns/provider.ts`
- Test: `src/server/dns/provider.test.ts`

**Interfaces:**
- Produces:
  - `type DnsProviderId = "godaddy" | "cloud-dns" | "manual"`
  - `type DnsRecord = { name: string; type: string; data: string; ttl?: number }`
  - `type EnsureResult = "created" | "exists" | "external"`
  - `interface DnsProvider { readonly id: DnsProviderId; ensureRecord(zone, record): Promise<EnsureResult>; verifyRecord(zone, record): Promise<boolean>; removeRecord(zone, record): Promise<void> }`
  - `relativeName(fqdn: string, zone: string): string`
  - `toFqdn(name: string, zone: string): string`
  - `normalizeData(type: string, data: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns/provider.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/dns/provider.test.ts`
Expected: FAIL — cannot find module `./provider.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns/provider.ts
/**
 * DNS provider abstraction. The provisioning orchestrator writes the records
 * Cloud Run requires through whichever provider the environment selects
 * (GoDaddy API today; Cloud DNS later; "manual" when we have no API access).
 * Mirrors the env-driven mode switch in `studio-auth.ts` / `ai/config.ts`.
 */

export type DnsProviderId = "godaddy" | "cloud-dns" | "manual";

/** A single DNS record in absolute (FQDN) terms. `data` is the value
 *  (CNAME target, A address, TXT string). */
export type DnsRecord = { name: string; type: string; data: string; ttl?: number };

/** Result of an idempotent upsert: we wrote it, it was already there, or the
 *  provider does not write (operator sets it at their registrar). */
export type EnsureResult = "created" | "exists" | "external";

export interface DnsProvider {
  readonly id: DnsProviderId;
  /** Idempotent upsert of one record into `zone` (the registrable apex). */
  ensureRecord(zone: string, record: DnsRecord): Promise<EnsureResult>;
  /** True if the record is currently present/resolvable — for verification. */
  verifyRecord(zone: string, record: DnsRecord): Promise<boolean>;
  /** Remove the record (unprovision / cleanup). */
  removeRecord(zone: string, record: DnsRecord): Promise<void>;
}

/** `muldoon.sites.anchorcorps.com` in zone `anchorcorps.com` → `muldoon.sites`.
 *  The apex itself → `@`. Tolerates trailing dots and mixed case. */
export function relativeName(fqdn: string, zone: string): string {
  const f = fqdn.replace(/\.+$/, "").toLowerCase();
  const z = zone.replace(/\.+$/, "").toLowerCase();
  if (f === z) return "@";
  if (f.endsWith(`.${z}`)) return f.slice(0, f.length - z.length - 1);
  return f;
}

/** Inverse of `relativeName`. `@` → the apex. */
export function toFqdn(name: string, zone: string): string {
  const z = zone.replace(/\.+$/, "").toLowerCase();
  if (name === "@" || name === "") return z;
  return `${name.replace(/\.+$/, "").toLowerCase()}.${z}`;
}

/** Normalize a record value for comparison. CNAME targets are
 *  case-insensitive and trailing-dot-insensitive; everything else is trimmed. */
export function normalizeData(type: string, data: string): string {
  const d = data.trim();
  return type.toUpperCase() === "CNAME" ? d.replace(/\.+$/, "").toLowerCase() : d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/dns/provider.test.ts`
Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns/provider.ts src/server/dns/provider.test.ts
git commit -m "feat(dns): DnsProvider interface + shared name/data helpers"
```

---

### Task 2: GoDaddy DNS provider

**Files:**
- Create: `src/server/dns/godaddy.ts`
- Test: `src/server/dns/godaddy.test.ts`

**Interfaces:**
- Consumes: `DnsProvider`, `DnsRecord`, `EnsureResult`, `relativeName`, `normalizeData` from `./provider.js`.
- Produces:
  - `type GoDaddyConfig = { apiKey: string; apiSecret: string; baseUrl: string }`
  - `getGoDaddyConfig(env?): GoDaddyConfig | null` (null when creds absent)
  - `class GoDaddyDnsProvider implements DnsProvider` (`id = "godaddy"`)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns/godaddy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoDaddyDnsProvider, getGoDaddyConfig } from "./godaddy.js";

const CFG = { apiKey: "k", apiSecret: "s", baseUrl: "https://api.godaddy.test" };
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

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("getGoDaddyConfig", () => {
  it("returns null when creds are absent", () => {
    expect(getGoDaddyConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("reads key/secret and defaults the base url", () => {
    const cfg = getGoDaddyConfig({ GODADDY_API_KEY: "k", GODADDY_API_SECRET: "s" } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ apiKey: "k", apiSecret: "s", baseUrl: "https://api.godaddy.com" });
  });
});

describe("GoDaddyDnsProvider.ensureRecord", () => {
  it("PUTs the relative record and returns 'created' when absent", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "PUT") return { status: 200, body: undefined };
      return { status: 200, body: [] }; // GET: no existing record
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("created");
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect(put[0]).toBe(
      "https://api.godaddy.test/v1/domains/anchorcorps.com/records/CNAME/muldoon-dental.sites",
    );
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual([
      { data: "ghs.googlehosted.com", ttl: 3600 },
    ]);
    // Auth header present but never the only assertion — confirm shape:
    expect((put[1] as RequestInit).headers).toMatchObject({ Authorization: "sso-key k:s" });
  });

  it("returns 'exists' and does not PUT when the record already matches", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: [{ data: "ghs.googlehosted.com.", ttl: 3600 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record);

    expect(result).toBe("exists");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PUT")).toBe(false);
  });
});

describe("GoDaddyDnsProvider.verifyRecord", () => {
  it("is true when GoDaddy returns the matching value", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 200, body: [{ data: "ghs.googlehosted.com" }] })));
    expect(await new GoDaddyDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(true);
  });
  it("is false on a 404 (no such record)", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 404, body: { code: "NOT_FOUND" } })));
    expect(await new GoDaddyDnsProvider(CFG).verifyRecord("anchorcorps.com", record)).toBe(false);
  });
});

describe("GoDaddyDnsProvider error handling", () => {
  it("throws on a non-404 error without leaking the secret", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ status: 500, body: { message: "boom" } })));
    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.toThrow(/GoDaddy 500/);
    await expect(
      new GoDaddyDnsProvider(CFG).ensureRecord("anchorcorps.com", record),
    ).rejects.not.toThrow(/sso-key/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/dns/godaddy.test.ts`
Expected: FAIL — cannot find module `./godaddy.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns/godaddy.ts
/**
 * GoDaddy DNS provider. Reads/writes records via the GoDaddy v1 API
 * (`/v1/domains/{zone}/records/{type}/{name}`). Auth header is
 * `Authorization: sso-key <KEY>:<SECRET>` — never logged.
 *
 * Server creds come from `GODADDY_API_KEY` / `GODADDY_API_SECRET` in Secret
 * Manager → Cloud Run. The local `~/.claude/skills/godaddy/credentials.env`
 * file is for CLI use only and is never read here.
 */
import {
  type DnsProvider,
  type DnsRecord,
  type EnsureResult,
  relativeName,
  normalizeData,
} from "./provider.js";

export type GoDaddyConfig = { apiKey: string; apiSecret: string; baseUrl: string };

export function getGoDaddyConfig(env: NodeJS.ProcessEnv = process.env): GoDaddyConfig | null {
  const apiKey = env.GODADDY_API_KEY?.trim();
  const apiSecret = env.GODADDY_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  const baseUrl = (env.GODADDY_API_BASE?.trim() || "https://api.godaddy.com").replace(/\/+$/, "");
  return { apiKey, apiSecret, baseUrl };
}

type GoDaddyRecord = { data: string; name?: string; type?: string; ttl?: number };

export class GoDaddyDnsProvider implements DnsProvider {
  readonly id = "godaddy" as const;
  constructor(private readonly cfg: GoDaddyConfig) {}

  private async req(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `sso-key ${this.cfg.apiKey}:${this.cfg.apiSecret}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    // 404 is a normal "no such record" answer, not an error.
    if (!res.ok && res.status !== 404) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`GoDaddy ${res.status} ${path}: ${detail}`);
    }
    return { status: res.status, body };
  }

  private async getRecords(zone: string, type: string, name: string): Promise<GoDaddyRecord[]> {
    const { status, body } = await this.req(
      `/v1/domains/${encodeURIComponent(zone)}/records/${type}/${encodeURIComponent(name)}`,
    );
    if (status === 404 || !Array.isArray(body)) return [];
    return body as GoDaddyRecord[];
  }

  async ensureRecord(zone: string, record: DnsRecord): Promise<EnsureResult> {
    const name = relativeName(record.name, zone);
    const data = normalizeData(record.type, record.data);
    const existing = await this.getRecords(zone, record.type, name);
    if (existing.some((r) => normalizeData(record.type, r.data) === data)) return "exists";
    await this.req(
      `/v1/domains/${encodeURIComponent(zone)}/records/${record.type}/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify([{ data, ttl: record.ttl ?? 3600 }]) },
    );
    return "created";
  }

  async verifyRecord(zone: string, record: DnsRecord): Promise<boolean> {
    const name = relativeName(record.name, zone);
    const data = normalizeData(record.type, record.data);
    const existing = await this.getRecords(zone, record.type, name);
    return existing.some((r) => normalizeData(record.type, r.data) === data);
  }

  async removeRecord(zone: string, record: DnsRecord): Promise<void> {
    const name = relativeName(record.name, zone);
    await this.req(
      `/v1/domains/${encodeURIComponent(zone)}/records/${record.type}/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/dns/godaddy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dns/godaddy.ts src/server/dns/godaddy.test.ts
git commit -m "feat(dns): GoDaddy DNS provider (idempotent record upsert + verify)"
```

---

### Task 3: Manual (lookup-verify / external) provider

**Files:**
- Create: `src/server/dns/manual.ts`
- Test: `src/server/dns/manual.test.ts`

**Interfaces:**
- Consumes: `DnsProvider`, `DnsRecord`, `EnsureResult`, `normalizeData` from `./provider.js`.
- Produces:
  - `interface DnsResolver { resolveCname(host): Promise<string[]>; resolve4(host): Promise<string[]>; resolveTxt(host): Promise<string[][]> }`
  - `class ManualDnsProvider implements DnsProvider` (`id = "manual"`), constructor `(resolver?: DnsResolver)` defaulting to a `node:dns/promises` `Resolver`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns/manual.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/dns/manual.test.ts`
Expected: FAIL — cannot find module `./manual.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns/manual.ts
/**
 * "Manual" / external DNS provider — the Wix-style "point your existing
 * domain" mode, and the honest fallback when we have no API access to a
 * domain. It never writes: the operator sets records at their registrar.
 * Verification is a live DNS lookup so status still works in the UI/CLI.
 */
import { Resolver } from "node:dns/promises";
import { type DnsProvider, type DnsRecord, type EnsureResult, normalizeData } from "./provider.js";

/** The subset of `node:dns/promises` Resolver we use — injectable for tests. */
export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
}

export class ManualDnsProvider implements DnsProvider {
  readonly id = "manual" as const;
  constructor(private readonly resolver: DnsResolver = new Resolver()) {}

  async ensureRecord(): Promise<EnsureResult> {
    return "external"; // operator sets it at their registrar
  }

  async removeRecord(): Promise<void> {
    // Nothing to remove; the record lives outside our control.
  }

  async verifyRecord(_zone: string, record: DnsRecord): Promise<boolean> {
    const host = record.name.replace(/\.+$/, "");
    const want = normalizeData(record.type, record.data);
    const type = record.type.toUpperCase();
    try {
      if (type === "CNAME") {
        const got = await this.resolver.resolveCname(host);
        return got.some((g) => normalizeData("CNAME", g) === want);
      }
      if (type === "A") {
        const got = await this.resolver.resolve4(host);
        return got.includes(want);
      }
      if (type === "TXT") {
        const got = await this.resolver.resolveTxt(host);
        return got.some((chunks) => chunks.join("") === want);
      }
      return false;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/dns/manual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dns/manual.ts src/server/dns/manual.test.ts
git commit -m "feat(dns): manual/external provider (lookup-based verify, no writes)"
```

---

### Task 4: Cloud DNS stub + provider resolution

**Files:**
- Create: `src/server/dns/cloud-dns.ts`
- Create: `src/server/dns/resolve.ts`
- Test: `src/server/dns/resolve.test.ts`

**Interfaces:**
- Consumes: `DnsProvider`, `EnsureResult` from `./provider.js`; `GoDaddyDnsProvider`, `getGoDaddyConfig` from `./godaddy.js`; `ManualDnsProvider` from `./manual.js`; `CloudDnsProvider` from `./cloud-dns.js`.
- Produces:
  - `class CloudDnsProvider implements DnsProvider` (`id = "cloud-dns"`, every method throws "not yet implemented").
  - `resolveDnsProvider(env?): DnsProvider`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns/resolve.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/dns/resolve.test.ts`
Expected: FAIL — cannot find module `./resolve.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns/cloud-dns.ts
/**
 * Google Cloud DNS provider — interface-ready, NOT yet implemented. The
 * abstraction leaves the slot open so a Google-hosted managed zone can be
 * dropped in later (Wix-style "use our nameservers"). Until then every method
 * throws so misconfiguration fails loudly rather than silently no-op'ing.
 */
import { type DnsProvider, type EnsureResult } from "./provider.js";

const NOT_READY =
  "Cloud DNS provider is interface-ready but not yet implemented; set DNS_PROVIDER=godaddy or manual.";

export class CloudDnsProvider implements DnsProvider {
  readonly id = "cloud-dns" as const;
  async ensureRecord(): Promise<EnsureResult> {
    throw new Error(NOT_READY);
  }
  async verifyRecord(): Promise<boolean> {
    throw new Error(NOT_READY);
  }
  async removeRecord(): Promise<void> {
    throw new Error(NOT_READY);
  }
}
```

```ts
// src/server/dns/resolve.ts
/**
 * Pick the DNS provider from the environment, mirroring
 * `resolveStudioAuthMode`. Default: GoDaddy when creds are present, else
 * "manual" (graceful degradation — never crash for missing creds). Force a
 * specific backend with `DNS_PROVIDER=godaddy|manual|cloud-dns`.
 */
import { type DnsProvider } from "./provider.js";
import { GoDaddyDnsProvider, getGoDaddyConfig } from "./godaddy.js";
import { ManualDnsProvider } from "./manual.js";
import { CloudDnsProvider } from "./cloud-dns.js";

export function resolveDnsProvider(env: NodeJS.ProcessEnv = process.env): DnsProvider {
  const mode = env.DNS_PROVIDER?.trim().toLowerCase();
  if (mode === "manual") return new ManualDnsProvider();
  if (mode === "cloud-dns") return new CloudDnsProvider();

  const gd = getGoDaddyConfig(env);
  if (mode === "godaddy") {
    if (!gd) {
      throw new Error("DNS_PROVIDER=godaddy but GODADDY_API_KEY/GODADDY_API_SECRET are not set");
    }
    return new GoDaddyDnsProvider(gd);
  }
  return gd ? new GoDaddyDnsProvider(gd) : new ManualDnsProvider();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/dns/resolve.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns/cloud-dns.ts src/server/dns/resolve.ts src/server/dns/resolve.test.ts
git commit -m "feat(dns): cloud-dns stub + env-driven resolveDnsProvider"
```

---

### Task 5: Rewrite the orchestrator DNS step (drop Kinsta), update integration test

**Files:**
- Modify: `src/server/provisioning/orchestrator.ts`
- Modify: `tests/integration/provisioning.test.ts`

**Interfaces:**
- Consumes: `resolveDnsProvider` from `../dns/resolve.js`; `DnsProvider`, `DnsRecord` from `../dns/provider.js`; existing `CloudRunDomainsClient` (uses `createIfMissing`, `getRequiredDnsRecords`, `waitForReady`).
- Produces (changed):
  - `type ProvisionStep = "lookup" | "site_domains" | "cloud_run" | "dns" | "wait_ready"` (`"kinsta"` → `"dns"`, reordered)
  - `ProvisionOptions.dns?: DnsProvider` (replaces `kinsta?: KinstaClient`)

- [ ] **Step 1: Update the integration test to the new contract (failing)**

Replace the Kinsta mock helper and assertions. New file content for the changed regions:

```ts
// tests/integration/provisioning.test.ts — replace the import + makeKinstaMock,
// the makeCloudRunMock body, and the four affected `it(...)` blocks.

// --- imports (replace the kinsta import) ---
import type { DnsProvider, EnsureResult } from "../../src/server/dns/provider.js";
import type { CloudRunDomainsClient } from "../../src/server/gcloud/run-domains.js";

// --- replace makeKinstaMock with makeDnsMock ---
function makeDnsMock(ensure: EnsureResult = "created"): DnsProvider {
  return {
    id: "godaddy",
    ensureRecord: vi.fn(async () => ensure),
    verifyRecord: vi.fn(async () => true),
    removeRecord: vi.fn(async () => undefined),
  } as unknown as DnsProvider;
}

// --- makeCloudRunMock: add resourceRecords + getRequiredDnsRecords ---
function makeCloudRunMock(ready = true): CloudRunDomainsClient {
  const mapping = {
    apiVersion: "domains.cloudrun.com/v1",
    kind: "DomainMapping",
    metadata: { name: "x", namespace: "p" },
    spec: { routeName: "anchor-sites" },
    status: {
      conditions: ready
        ? [
            { type: "Ready", status: "True" },
            { type: "CertificateProvisioned", status: "True" },
          ]
        : [
            { type: "Ready", status: "Unknown" },
            { type: "CertificateProvisioned", status: "Unknown" },
          ],
      resourceRecords: [
        {
          name: "muldoon-dental.sites.anchorcorps.com.",
          type: "CNAME",
          rrdata: "ghs.googlehosted.com.",
        },
      ],
    },
  };
  return {
    createIfMissing: vi.fn(async () => mapping),
    waitForReady: vi.fn(async () => mapping),
    getRequiredDnsRecords: vi.fn(async () => mapping.status.resourceRecords),
    get: vi.fn(async () => mapping),
  } as unknown as CloudRunDomainsClient;
}

// --- test 1: end-to-end ---
it("provisions a fresh hostname end-to-end (mocked DNS + Cloud Run)", async () => {
  const dns = makeDnsMock("created");
  const cloudRun = makeCloudRunMock(true);
  const result: ProvisionResult = await provisionSiteHostname(muldoonId, {
    pool,
    dns,
    cloudRun,
    wait: true,
  });

  expect(result.hostname).toBe("muldoon-dental.sites.anchorcorps.com");
  const stepStatuses = Object.fromEntries(result.steps.map((s) => [s.step, s.status]));
  expect(stepStatuses).toMatchObject({
    lookup: "ok",
    site_domains: "ok",
    cloud_run: "ok",
    dns: "ok",
    wait_ready: "ok",
  });
  expect(result.ready).toBe(true);
  expect(dns.ensureRecord).toHaveBeenCalledWith(
    "anchorcorps.com",
    expect.objectContaining({ type: "CNAME", data: "ghs.googlehosted.com." }),
  );
  expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
});

// --- test 2: idempotent skip ---
it("marks the dns step 'skipped' when the record already exists", async () => {
  const dns = makeDnsMock("exists");
  const cloudRun = makeCloudRunMock(true);
  const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun });

  const dnsStep = result.steps.find((s) => s.step === "dns");
  expect(dnsStep?.status).toBe("skipped");
  expect(dns.ensureRecord).toHaveBeenCalledOnce();
});

// --- test 3: ready false when wait omitted (unchanged except mock names) ---
it("returns 'ready: false' when wait is omitted, but mapping is still created", async () => {
  const dns = makeDnsMock();
  const cloudRun = makeCloudRunMock(false);
  const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun });
  expect(result.ready).toBe(false);
  expect(cloudRun.createIfMissing).toHaveBeenCalled();
  expect(cloudRun.waitForReady).not.toHaveBeenCalled();
});

// --- test 4: dns errors surface; mapping was already created (order flipped) ---
it("surfaces DNS errors as a failed step + returns early", async () => {
  const dns = makeDnsMock();
  (dns.ensureRecord as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("GoDaddy 500 boom"),
  );
  const cloudRun = makeCloudRunMock(true);
  const result = await provisionSiteHostname(muldoonId, { pool, dns, cloudRun, wait: true });

  expect(result.ready).toBe(false);
  const dnsStep = result.steps.find((s) => s.step === "dns");
  expect(dnsStep?.status).toBe("error");
  // Cloud Run mapping now happens BEFORE dns, so it ran:
  expect(cloudRun.createIfMissing).toHaveBeenCalledOnce();
  expect(cloudRun.waitForReady).not.toHaveBeenCalled();
});

// --- test 5: missing site (unchanged) ---
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run tests/integration/provisioning.test.ts`
Expected: FAIL — `orchestrator` still imports/uses Kinsta; `dns` option/step not recognized. (If `TEST_DATABASE_URL` is unset the suite is `describe.skip` — set it to a throwaway Postgres URL to actually exercise this.)

- [ ] **Step 3: Rewrite the orchestrator**

Apply these edits to `src/server/provisioning/orchestrator.ts`:

1. Replace the module docstring step list (lines 4–15) with the new order:

```ts
/**
 * Provision a tenant hostname end-to-end.
 *
 * Step order (each step is idempotent — re-running the orchestrator is
 * safe and useful when DNS or cert state is uncertain):
 *
 *   1. Resolve site by ID, compute canonical hostname `<slug>.<base>`.
 *   2. UPSERT `site_domains` row so the renderer can resolve the hostname
 *      via the explicit-domain path immediately.
 *   3. Cloud Run: createIfMissing the domain mapping for the hostname.
 *   4. DNS: read the records Cloud Run requires, then upsert each through
 *      the configured DnsProvider (GoDaddy / manual / cloud-dns). Idempotent.
 *   5. (Optional) wait for the mapping to report Ready +
 *      CertificateProvisioned both True.
 *
 * Designed to be called from both the admin HTTP endpoint and a CLI
 * script — same logic, same env contract.
 */
```

2. Replace the Kinsta import (line 29) with the DNS imports:

```ts
import { resolveDnsProvider } from "../dns/resolve.js";
import type { DnsProvider, DnsRecord } from "../dns/provider.js";
```

3. Change the `ProvisionStep` type (line 35):

```ts
export type ProvisionStep = "lookup" | "site_domains" | "cloud_run" | "dns" | "wait_ready";
```

4. In `ProvisionOptions` (lines 51–60) replace `kinsta?: KinstaClient;` with:

```ts
  dns?: DnsProvider;
```

5. Replace the client construction + steps 3 & 4 (current lines 107–162) with this block (note the reorder — Cloud Run first, DNS second):

```ts
  const dns = options.dns ?? resolveDnsProvider();
  const cloudRun = options.cloudRun ?? new CloudRunDomainsClient();

  // ---- 2. site_domains row -------------------------------------------
  await pool.query(
    `INSERT INTO site_domains (site_id, hostname, is_primary, verification_status, ssl_status)
     VALUES ($1, $2, true, 'pending', 'pending')
     ON CONFLICT (hostname) DO NOTHING`,
    [siteId, hostname],
  );
  evictSiteCache(hostname);
  steps.push({ step: "site_domains", status: "ok", detail: `upserted ${hostname}` });

  // ---- 3. Cloud Run mapping ------------------------------------------
  // Created BEFORE DNS because the records we must set come FROM the mapping.
  let mapping: DomainMapping | undefined;
  try {
    mapping = await cloudRun.createIfMissing(hostname);
    steps.push({
      step: "cloud_run",
      status: "ok",
      detail: `mapping for ${hostname} present`,
      data: mapping,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "cloud_run", status: "error", detail: msg });
    return { site_id: siteId, slug, hostname, steps, ready: false };
  }

  // ---- 4. DNS records (provider-driven) ------------------------------
  try {
    const required =
      mapping.status?.resourceRecords && mapping.status.resourceRecords.length > 0
        ? mapping.status.resourceRecords
        : await cloudRun.getRequiredDnsRecords(hostname);

    if (required.length === 0) {
      steps.push({
        step: "dns",
        status: "skipped",
        detail: `Cloud Run reported no DNS records yet for ${hostname}`,
      });
    } else {
      const recs: DnsRecord[] = required.map((r) => ({
        name: r.name ?? hostname,
        type: (r.type ?? "CNAME").toUpperCase(),
        data: r.rrdata ?? "",
      }));
      const results = await Promise.all(
        recs.map((rec) => dns.ensureRecord(cfg.registrable, rec)),
      );
      const created = results.filter((x) => x === "created").length;
      const external = results.filter((x) => x === "external").length;
      const detail =
        external > 0
          ? `${dns.id}: ${external} record(s) to set manually — ${recs
              .map((r) => `${r.name} ${r.type} ${r.data}`)
              .join("; ")}`
          : `${dns.id}: ${created} created, ${results.length - created} already present`;
      steps.push({ step: "dns", status: created > 0 ? "ok" : "skipped", detail });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "dns", status: "error", detail: msg });
    return { site_id: siteId, slug, hostname, steps, ready: false };
  }
```

6. Delete the now-duplicated old `// ---- 2. site_domains row` block and the old `// ---- 4. Cloud Run mapping` block (the original lines 110–162) — the replacement above already contains the single, reordered copy. Leave the `// ---- 5. Optional wait` block (originally 164+) and everything after it unchanged; `mapping` is already declared in the new block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run tests/integration/provisioning.test.ts`
Expected: PASS (5 tests).
Run: `npx tsc --noEmit`
Expected: no errors (confirms no dangling Kinsta import/type).

- [ ] **Step 5: Commit**

```bash
git add src/server/provisioning/orchestrator.ts tests/integration/provisioning.test.ts
git commit -m "feat(provisioning): provider-driven DNS step, drop Kinsta from orchestrator"
```

---

### Task 6: Delete the Kinsta client + scrub code references

**Files:**
- Delete: `src/server/kinsta/client.ts`, `src/server/kinsta/client.test.ts` (and the `src/server/kinsta/` dir)
- Modify: `scripts/provision-site.ts`
- Modify: `src/server/routes/admin-pages.ts:369`
- Modify: `src/config/domain.ts` (comment only)

- [ ] **Step 1: Delete the Kinsta module**

```bash
git rm src/server/kinsta/client.ts src/server/kinsta/client.test.ts
```

- [ ] **Step 2: Fix `scripts/provision-site.ts`**

Replace the env doc lines (currently lines 16–17):

```
 *   KINSTA_API_KEY            — Kinsta v2 bearer token
 *   KINSTA_AGENCY_ID          — Kinsta company UUID
```

with:

```
 *   DNS_PROVIDER              — godaddy | manual | cloud-dns (default: godaddy if creds set, else manual)
 *   GODADDY_API_KEY           — GoDaddy API key (when DNS_PROVIDER=godaddy)
 *   GODADDY_API_SECRET        — GoDaddy API secret
```

Replace the informational line (currently line 86):

```ts
    console.log("DNS records Cloud Run expects (informational; Kinsta CNAME above should match):");
```

with:

```ts
    console.log("DNS records Cloud Run expects (applied via the configured DNS provider):");
```

- [ ] **Step 3: Fix the `admin-pages.ts` comment (line 369)**

Replace:

```ts
  // POST /api/sites/:siteId/provision — add Kinsta CNAME + Cloud Run mapping
```

with:

```ts
  // POST /api/sites/:siteId/provision — add DNS records + Cloud Run mapping
```

- [ ] **Step 4: Fix the `src/config/domain.ts` comment**

In the doc comment for `SITES_DOMAIN_REGISTRABLE` (around lines 13–16), replace the sentence:

```
 *     beneath. Defaults to `anchorcorps.com`. The Kinsta DNS client uses
 *     this to look up the zone via `/v2/domains?company=...`. Search Console
 *     ownership verification also lives at this level.
```

with:

```
 *     beneath. Defaults to `anchorcorps.com`. This is the DNS zone the
 *     configured DnsProvider writes records into. Search Console ownership
 *     verification also lives at this level.
```

- [ ] **Step 5: Verify the code is clean and compiles**

Run: `grep -rli kinsta src scripts tests`
Expected: no output.
Run: `npx tsc --noEmit && npx vitest run src/server/dns tests/integration/provisioning.test.ts`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete Kinsta client, scrub Kinsta from scripts/routes/config"
```

---

### Task 7: Scrub Kinsta from docs + planning files

**Files (modify):** `docs/provisioning.md`, `README.md`, `PHASE-01-foundation.md`, `PHASE-04-admin-ui-shell.md`, `DECISIONS.md`, `DEMO-LOG.md`, `BLOCKERS.md`

**Approach:** In each file, replace Kinsta-as-DNS-mechanism wording with the provider model ("the configured DNS provider (GoDaddy by default)"). For **dated historical entries** in `DEMO-LOG.md` and `BLOCKERS.md`, preserve the fact and date but reword the mechanism (e.g. "added the CNAME via Kinsta" → "added the CNAME via the DNS provider") — do not fabricate new history, just rename the tool. Flag these two files for the reviewer since they are logs.

- [ ] **Step 1: Find every remaining mention**

Run: `grep -rn -i kinsta docs README.md *.md`
Read each hit in context before editing.

- [ ] **Step 2: Rewrite `docs/provisioning.md`**

This is the main DNS doc. Replace the Kinsta-specific section(s) — zone lookup, CNAME creation, the `KINSTA_API_KEY` / `KINSTA_AGENCY_ID` env table rows, and the operator prereq — with the provider model:
- DNS env: `DNS_PROVIDER` (godaddy|manual|cloud-dns), `GODADDY_API_KEY`, `GODADDY_API_SECRET`, optional `GODADDY_API_BASE`.
- Mechanism: "Cloud Run reports the required records; the orchestrator upserts them through the configured `DnsProvider`. GoDaddy is the default when creds are present; otherwise `manual` mode surfaces the records for the operator and verifies by DNS lookup."
- Operator prereq: put `GODADDY_API_KEY` / `GODADDY_API_SECRET` in Secret Manager (`anchor-hub-480305`) and wire onto `anchor-sites` — same pattern as the Studio OAuth secrets. Mention `cloud-dns` is interface-ready for a future Google-hosted zone.

- [ ] **Step 3: Rewrite the remaining files**

For `README.md`, `PHASE-01-foundation.md`, `PHASE-04-admin-ui-shell.md`, `DECISIONS.md`: replace each "Kinsta" DNS reference with the provider wording. Where a decision record (`DECISIONS.md`) documents the Kinsta choice, add a short superseding note rather than deleting the history, e.g.:

```
> **Superseded 2026-06-28:** DNS is no longer Kinsta. Records are managed
> through a pluggable DnsProvider (GoDaddy default; Cloud DNS interface-ready).
> See docs/superpowers/specs/2026-06-28-gcloud-dns-remove-kinsta-design.md.
```

For `DEMO-LOG.md` and `BLOCKERS.md`: reword the mechanism in the dated entries (Kinsta → DNS provider) but keep dates/outcomes intact.

- [ ] **Step 4: Verify the scrub is complete**

Run: `grep -rli kinsta . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`
Expected: ONLY the two design docs:
```
docs/superpowers/specs/2026-06-28-gcloud-dns-remove-kinsta-design.md
docs/superpowers/plans/2026-06-28-gcloud-dns-remove-kinsta.md
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: scrub Kinsta from docs + planning, document the DnsProvider model"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (integration provisioning tests skip cleanly if `TEST_DATABASE_URL` is unset; the new `src/server/dns/*` unit tests run unconditionally and pass).

- [ ] **Step 3: Final Kinsta grep**

Run: `grep -rli kinsta . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`
Expected: only the two design docs.

- [ ] **Step 4: Commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification pass for Kinsta removal / DnsProvider"
```

---

## Self-Review

**Spec coverage:**
- DnsProvider abstraction → Task 1. ✅
- GoDaddy provider (built now) → Task 2. ✅
- Manual provider (built now, lookup verify) → Task 3. ✅
- Cloud DNS interface-ready stub → Task 4. ✅
- Provider resolution (env-driven, graceful degradation) → Task 4. ✅
- Orchestrator DNS step rewrite, mapping-first, idempotent, `"dns"` label → Task 5. ✅
- Kinsta purge (code) → Task 6; (docs/planning) → Task 7. ✅
- Tests, no live calls → Tasks 1–5 (mocked fetch + injected resolver + injected provider). ✅
- Operator prereq (GoDaddy creds → Secret Manager) → documented in Task 7 (docs/provisioning.md). ✅
- Phase 10 dashboard UI → intentionally spec-only, NOT in this plan (spec "Out of scope"). ✅

**Interface note vs spec:** the spec listed `listRecords(zone)` on the provider; the plan uses `verifyRecord(zone, record)` instead — a per-record presence check, which is what verification and idempotency actually need and which the manual (DNS-lookup) provider can implement (a zone-wide list is not resolvable via DNS). Semantics preserved; method renamed for honesty.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `DnsRecord` (`name/type/data/ttl?`), `EnsureResult` (`created|exists|external`), and the `DnsProvider` method signatures are identical across Tasks 1–5. The orchestrator option is `dns?: DnsProvider`; the step label is `"dns"`; both used consistently in Task 5 test and impl. Cloud Run mock gains `getRequiredDnsRecords` + `status.resourceRecords`, matching the orchestrator's read path. ✅
