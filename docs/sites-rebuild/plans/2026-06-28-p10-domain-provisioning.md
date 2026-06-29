# Phase 10 — Domain provisioning (Cloud Run mapping, DNS, SSL)

**Goal:** finish automated domain provisioning — a pluggable DNS layer (retire the hardcoded
Kinsta step), support client-owned custom domains end-to-end (mapping → DNS → SSL → verify),
and a Studio "Domains" tab. Builds on the existing skeleton; do NOT re-invent it.

## What already exists (reuse, don't rebuild)
- `src/config/domain.ts` — `hostnameForSlug`, `subdomainPattern`, `SITES_DOMAIN_BASE`/`_REGISTRABLE`.
- `site_domains` table (migration `1747571000000`) — `hostname` UNIQUE, `is_primary`,
  `verification_status` (pending|verified|failed), `ssl_status` (pending|active|failed).
- `src/middleware/resolveSite.ts` — exact-domain lookup → subdomain fallback (already supports
  arbitrary custom hostnames via `site_domains`).
- `src/server/gcloud/run-domains.ts` — Cloud Run DomainMapping client: `get`/`create`/
  `createIfMissing`/`waitForReady` (polls Ready + CertificateProvisioned) /
  `getRequiredDnsRecords` (the records the operator/client must add). AUTOMATIC cert mode.
- `src/server/provisioning/orchestrator.ts` — 5-step pipeline: lookup → site_domains upsert →
  **kinsta DNS (HARDCODED — replace)** → cloud_run mapping → wait_ready (updates site_domains status).
- `src/server/sites/create-site.ts` — `createSiteWithDomains` inserts canonical subdomain + `.localhost`.
- Spec: `docs/superpowers/specs/2026-06-28-gcloud-dns-remove-kinsta-design.md` (DnsProvider design).
- `docs/provisioning.md` (current flow + "does NOT handle client-owned domains → Phase 10").

## Design decisions (record as they land)
- **D-050 — Pluggable DnsProvider, Kinsta retired.** `DnsProvider` interface
  (`listRecords`/`ensureRecord`/`removeRecord`) with backends: `godaddy` (auto-writes
  `anchorcorps.com` records via the GoDaddy API), `manual` (no-op writes + `dns/promises`
  verification for client-owned zones), `cloud-dns` (stub). `resolveDnsProvider(env)` fallback
  GoDaddy → Cloud DNS → Manual. Orchestrator DNS step uses `getRequiredDnsRecords(hostname)`
  (Cloud Run's truth) + `provider.ensureRecord`, not a hardcoded CNAME. Kinsta client removed/shimmed.
- **D-051 — Two domain classes.** (1) MANAGED subdomains under `*.sites.anchorcorps.com` — we own
  DNS (GoDaddy) → fully automated. (2) CLIENT-OWNED custom domains (apex `acme.com` via A records,
  `www` via CNAME) — we create the Cloud Run mapping + surface required records; the client adds
  them at their registrar; we poll verify + SSL (manual provider). Provisioning is non-blocking
  (kick off mapping+DNS, return required records, poll status) — cert issuance can take ~15–20 min.

⚠️ **Shared-secret deploy gotcha** (operator memory): GoDaddy creds are shared across services, and
Cloud Run `--set-secrets` REPLACES the whole secret list — when adding `GODADDY_API_KEY`/`_SECRET`
to the anchor-sites service, append to the EXISTING `--set-secrets` list (don't drop
`ANCHOR_SITES_DATABASE_URL`/`ADMIN_API_TOKEN`/`MAILGUN_*`), and add them in `cloudbuild.yaml`'s
deploy step too so a later CI deploy doesn't lapse them.

## Tasks (per-subitem commits; TDD; pool-injected + clients injectable for tests)
- **10.1** `DnsProvider` interface + `DnsRecord` type + `resolveDnsProvider(env)` (provider id +
  fallback order). Unit tests for resolution.
- **10.2** `godaddy` DNS provider (`src/server/dns/godaddy.ts`) — `sso-key` auth, `GET/PUT
  /v1/domains/{zone}/records`; idempotent `ensureRecord`; env `GODADDY_API_KEY`/`GODADDY_API_SECRET`/
  `GODADDY_API_BASE`. Injectable fetch; tests with a stubbed HTTP layer.
- **10.3** `manual` DNS provider — no-op writes; `dns/promises` live lookup for verification. Tests.
- **10.4** Rewrite orchestrator DNS step: replace the Kinsta block with
  `getRequiredDnsRecords(hostname)` → `provider.ensureRecord` per record; classify managed vs
  client-owned; retire/shim the Kinsta client. Update `docs/provisioning.md`. D-050. Tests for the
  rewired pipeline (injected provider + Cloud Run client).
- **10.5** Custom-domain API: `POST /api/sites/:siteId/domains` (add hostname; validate format,
  not already mapped, classify managed/client-owned), `GET /api/sites/:siteId/domains` (list with
  status), `DELETE /api/sites/:siteId/domains/:domainId`. requireAdmin. D-051. Integration tests.
- **10.6** Provision/verify/unprovision: `POST .../domains/:id/provision` (create Cloud Run mapping
  + ensure DNS for managed; for client-owned return required records), `GET .../domains/:id/status`
  (poll Ready/CertificateProvisioned → update `verification_status`/`ssl_status`), unprovision on
  DELETE (remove mapping + DNS record). Idempotent. Tests.
- **10.7** Studio "Domains" tab (`src/admin/pages/site-tabs/DomainsTab.tsx`): list domains with
  DNS/SSL status badges, add-domain form, copyable required-records table (from
  `getRequiredDnsRecords`), remove + re-check. Register in `SiteDetailPage`; make the SettingsTab
  "Hostnames" card link here. jsdom tests.
- **10.8** Wire provisioning into create-site / make the canonical subdomain auto-provision
  (non-blocking) or operator-triggered from the tab; surface status. Tests.
- **10.9** `docs/domains.md` (full model) + record D-050/D-051 in `docs/data-model.md`; deprecate
  Kinsta docs; bump the SettingsTab/admin-ui note. Final cold suite + typecheck green.

## Operator prereqs (build proceeds without them; flag in the PR if blocking a live cutover)
- `GODADDY_API_KEY` + `GODADDY_API_SECRET` in Secret Manager (project `anchor-hub-480305`) and on
  the `anchor-sites` Cloud Run service env + `cloudbuild.yaml` (see the shared-secret gotcha above).
- For client-owned domains: the client adds the surfaced DNS records at their registrar before SSL issues.
