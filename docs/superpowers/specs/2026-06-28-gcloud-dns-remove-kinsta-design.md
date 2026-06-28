# Design — gcloud-hosted sites, pluggable DNS, zero Kinsta

**Date:** 2026-06-28
**Status:** Approved (design); plan to follow
**Touches:** Phase 10 (domain provisioning) — backend now, dashboard UI specced for Phase 10

## Problem

This app builds and manages **React sites**. The only reason **Kinsta** (a
WordPress host) appears in the codebase is that it is currently the
authoritative DNS provider for `anchorcorps.com`, so the provisioning
orchestrator writes tenant CNAMEs through the Kinsta v2 API. That is an odd,
off-brand dependency for a React-site builder and the operator wants it gone.

Goal: **no reference to Kinsta whatsoever**, DNS records managed at **GoDaddy
via its API** (generate / set / verify, the same UX Kinsta gave us) while
**Google Cloud hosts the sites** and records point at Cloud Run. Leave the DNS
backend **pluggable** so a Google **Cloud DNS** managed zone can be slotted in
later (Wix-style: "use our nameservers" *or* "point your existing domain").

## Key existing seam

`src/server/gcloud/run-domains.ts` already exposes
`getRequiredDnsRecords(hostname)` — Cloud Run returns the exact records
(`name` / `type` / `rrdata`) a mapped domain needs, plus `Ready` /
`CertificateProvisioned` status. The hardcoded `CNAME → ghs.googlehosted.com.`
in the Kinsta step was a shortcut; the generic source of truth already exists.
The new DNS step rotates around this call.

## Architecture

### 1. `DnsProvider` abstraction

New module `src/server/dns/`. Small interface so DNS backends are swappable,
mirroring the env-driven mode-switch already used by `studio-auth.ts` and
`ai/config.ts`.

```ts
export type DnsRecord = { name: string; type: string; data: string; ttl?: number };

export interface DnsProvider {
  readonly id: "godaddy" | "cloud-dns" | "manual";
  /** Records currently live in the zone — used for verification. */
  listRecords(zone: string): Promise<DnsRecord[]>;
  /** Idempotent upsert: create if absent, leave alone if already correct. */
  ensureRecord(zone: string, record: DnsRecord): Promise<void>;
  /** Remove a record (unprovision / cleanup). */
  removeRecord(zone: string, record: DnsRecord): Promise<void>;
}
```

Implementations:

- **`godaddy.ts` (built now)** — writes via the GoDaddy API
  (`GET/PUT/PATCH /v1/domains/{domain}/records`). Auth header
  `Authorization: sso-key <KEY>:<SECRET>`. Reads `GODADDY_API_KEY`,
  `GODADDY_API_SECRET`, `GODADDY_API_BASE` (default `https://api.godaddy.com`)
  from env. The default provider whenever GoDaddy creds are present.
  `ensureRecord` lists the type+name first and skips if an equivalent record
  exists (idempotent), else `PUT /records/{TYPE}/{name}`.

- **`manual.ts` (built now)** — the "point from anywhere / Wix-style external"
  mode and the honest fallback when we have no API access to a client's domain.
  `ensureRecord` / `removeRecord` are **no-ops** (the operator sets the record
  at whatever registrar); `listRecords` performs a **live DNS lookup**
  (Node `dns/promises`) so verification still works.

- **`cloud-dns.ts` (interface-ready, NOT built)** — Google Cloud DNS managed
  zone. Leaves the slot open as requested; a documented stub that throws
  "Cloud DNS provider not configured" until the day a Google-hosted zone is
  wanted. No Cloud DNS code ships in this change.

### 2. Provider resolution

`resolveDnsProvider(env)` mirrors `resolveStudioAuthMode`:

| Condition | Provider |
|---|---|
| `DNS_PROVIDER=godaddy` (or unset) **and** GoDaddy creds present | `godaddy` |
| `DNS_PROVIDER=cloud-dns` | `cloud-dns` (stub → throws until built) |
| `DNS_PROVIDER=manual`, or creds absent | `manual` |

Global default for now; a per-domain override is a Phase 10 UI concern, not in
this change. No secrets present → `manual` (no lockout, same graceful
degradation as auth).

### 3. Orchestrator rewrite

`src/server/provisioning/orchestrator.ts`: the `"kinsta"` step becomes `"dns"`
and stops hardcoding anything. New step order (mapping first, because the
required records come *from* the mapping):

1. **lookup** — resolve `site_id` (unchanged).
2. **site_domains** — UPSERT the canonical hostname row (unchanged).
3. **cloud_run** — ensure the Cloud Run domain mapping (already built).
4. **dns** — `getRequiredDnsRecords(hostname)` → for each record
   `provider.ensureRecord(zone, record)`. Idempotent; re-runs safe.
5. **wait_ready** — poll mapping to `Ready` + `CertificateProvisioned`
   (unchanged).

`ProvisionStep` type: replace `"kinsta"` with `"dns"`. The injectable
`options.kinsta` becomes `options.dns?: DnsProvider`. `zone` is the registrable
apex from `getDomainConfig().registrable`.

### 4. Kinsta purge (now)

- Delete `src/server/kinsta/` (`client.ts` + `client.test.ts`).
- Remove the import + step from the orchestrator.
- Fix the comment in `src/config/domain.ts` (drop "Kinsta DNS client uses
  this…"; the `registrable` field is now the DNS zone the provider writes to).
- Update the comment block in `src/server/routes/admin-pages.ts`
  (`add Kinsta CNAME` → `add DNS records`).
- Scrub `docs/provisioning.md` and the planning `.md` files
  (`PHASE-01-foundation.md`, `PHASE-03-multi-tenant-renderer.md`,
  `DECISIONS.md`, `BLOCKERS.md`, `DEMO-LOG.md`, `README.md` — whichever match)
  of Kinsta DNS references, replacing with the provider model.
- **Acceptance:** `grep -ri kinsta` over the repo returns nothing.

### 5. Tests

- Delete `kinsta/client.test.ts`.
- `tests/integration/provisioning.test.ts`: swap the Kinsta mock for an
  injected fake `DnsProvider`; assert `ensureRecord` is called with the records
  Cloud Run returns, and that a second run is a no-op (idempotency).
- New unit tests: `dns/godaddy.test.ts` (record mapping + idempotent skip,
  GoDaddy API mocked), `dns/manual.test.ts` (lookup-based verify, mocked
  resolver), `dns/resolve.test.ts` (every branch of `resolveDnsProvider`).
- No live GoDaddy or DNS calls in tests — all mocked, mirroring the existing
  "no live Google round-trip" testing convention.

## Operator prerequisite

For the server to write GoDaddy records in production, put
`GODADDY_API_KEY` + `GODADDY_API_SECRET` in Secret Manager (project
`anchor-hub-480305`) and wire onto the `anchor-sites` Cloud Run service —
exactly the pattern just used for the Studio OAuth secrets. Until then prod
runs in `manual` mode (surfaces required records, verifies by lookup). The
local `~/.claude/skills/godaddy/credentials.env` file is for CLI use only and
is never read by the server.

## Phase 10 — Dashboard "Domains" tab (spec only; built in Phase 10)

Makes the currently read-only Settings → Hostnames card real. Not built in
this change; captured here so Phase 10 picks it up.

- Per-site domain list with **status badges**: DNS (pending / verified) and
  SSL (pending / active), from the mapping status + provider `listRecords`.
- **Add domain** → enter hostname → choose mode (GoDaddy auto / Manual point /
  Cloud DNS later).
- **Required-records table** (copyable) straight from `getRequiredDnsRecords` —
  the "here's exactly what to set" UX from Kinsta / Wix / Vercel.
- **Verify** button → re-poll DNS + mapping.
- **Remove** → new `DELETE /api/sites/:siteId/provision` unprovision path
  (delete mapping + `provider.removeRecord`).
- Backend support to add in Phase 10: `GET` status endpoint + the `DELETE`
  unprovision endpoint (the `POST` provision endpoints already exist).

## Out of scope

- Building the Cloud DNS provider (interface-ready only).
- Building the Phase 10 dashboard UI (specced above, not implemented here).
- Per-domain provider override UI.
- A load balancer / wildcard-cert infrastructure change (separate Phase 10
  scale decision, untouched here).

## Acceptance criteria

1. `grep -ri kinsta` over the repo returns zero matches.
2. `src/server/dns/` provides `DnsProvider`, GoDaddy + manual implementations,
   and `resolveDnsProvider`.
3. The orchestrator's DNS step is provider-driven off
   `getRequiredDnsRecords`, idempotent, with a `"dns"` step label.
4. Provisioning integration + new DNS unit tests pass with no live calls.
5. In `manual` mode (no creds) provisioning still completes the mapping and
   reports required records without error.
