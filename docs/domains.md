# Domain provisioning — full model (Phase 10)

This document covers the end-to-end domain model for Anchor Sites:
two domain classes, the pluggable DNS provider layer, the provisioning
pipeline, and the Studio admin UI surface. For the low-level Cloud Run
client and the provisioning orchestrator, see `docs/provisioning.md`.

## Two domain classes (D-051)

### 1. Managed subdomains (`*.sites.anchorcorps.com`)

Every new site automatically gets a canonical managed subdomain:
`<slug>.sites.anchorcorps.com`. Anchor owns the DNS zone (`anchorcorps.com`
via GoDaddy), so provisioning is fully automated:

1. A Cloud Run domain mapping is created for the hostname.
2. Cloud Run returns the required DNS records (CNAME → `ghs.googlehosted.com`).
3. The GoDaddy DNS provider writes those records automatically.
4. Cloud Run issues an AUTOMATIC TLS certificate — no human step needed.

Status lifecycle: `pending → verified` (DNS resolves) + `ssl_status pending → active`
(cert provisioned). Both are polled via `GET /api/sites/:id/domains/:domainId/status`.

### 2. Client-owned custom domains (`acme.com`, `www.acme.com`)

Clients can bring their own apex/subdomain. The process is non-blocking:

1. Operator adds the hostname via `POST /api/sites/:id/domains`.
2. Operator triggers `POST .../domains/:domainId/provision` (or clicks
   **Provision** in the Studio Domains tab).
3. The response includes a `required_records` array — the operator shares these
   with the client to configure at their registrar.
4. Cloud Run issues the TLS cert once the DNS records resolve (15–20 min typical).
5. Operator polls status via the **Domains** tab or
   `GET .../domains/:domainId/status` until `verified` / `active`.

## DNS provider abstraction (D-050)

`DnsProvider` interface (`src/server/dns/provider.ts`):

```ts
interface DnsProvider {
  readonly id: "godaddy" | "cloud-dns" | "manual";
  ensureRecord(zone: string, record: DnsRecord): Promise<"created" | "exists" | "external">;
  verifyRecord(zone: string, record: DnsRecord): Promise<boolean>;
  removeRecord(zone: string, record: DnsRecord): Promise<void>;
}
```

Provider selection (`src/server/dns/resolve.ts`) — in priority order:

| `DNS_PROVIDER` env | Behaviour |
|---|---|
| `godaddy` | GoDaddy API. Requires `GODADDY_API_KEY` / `GODADDY_API_SECRET`. |
| `cloud-dns` | Google Cloud DNS stub (future). |
| `manual` | No-op writes; live DNS lookup for verification. Used for client-owned zones. |
| (unset) | Auto: GoDaddy if creds present, else manual. |

`ensureRecord` returning `"external"` means the provider has no write
access to this zone — the operator must configure the record manually.

## Provisioning pipeline

Full step-by-step is in `docs/provisioning.md`. In short:

```
POST /api/sites/:siteId/domains/:domainId/provision
  → CloudRunDomainsClient.createIfMissing(hostname)
  → cloudRun.getRequiredDnsRecords(hostname)
  → DnsProvider.ensureRecord() for each required record
  → update site_domains.verification_status / ssl_status
  → return { steps, required_records }
```

The endpoint is **idempotent** — re-running it when DNS or cert state is
uncertain is always safe.

## Admin API

All routes require `X-Admin-Token` or a Studio session (`requireAdmin`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites/:siteId/domains` | List domains with `domain_class`, `verification_status`, `ssl_status`. |
| `POST` | `/api/sites/:siteId/domains` | Add a hostname (validated; no wildcards; 409 if already in use). |
| `DELETE` | `/api/sites/:siteId/domains/:domainId` | Remove + unprovision (Cloud Run mapping + DNS record, best-effort). Cannot remove the primary domain. |
| `POST` | `/api/sites/:siteId/domains/:domainId/provision` | Trigger Cloud Run mapping + DNS; returns `steps` + `required_records`. |
| `GET` | `/api/sites/:siteId/domains/:domainId/status` | Poll Cloud Run and refresh DB status; returns updated domain row. |

The `POST /api/sites` (create site) response now includes `canonical_domain_id`
so callers can navigate directly to the provision endpoint for the new site's
primary domain.

## Studio Domains tab

The **Domains** tab in Site Detail (`src/admin/pages/site-tabs/DomainsTab.tsx`):

- Lists all domains with DNS/SSL status badges and `managed`/`client-owned` labels.
- **Add domain** form for custom hostnames.
- **Provision** button per non-primary domain (triggers `POST .../provision`).
- **Required DNS records** table shown after provisioning a client-owned domain —
  a copyable CNAME/A record table the client configures at their registrar.
- **Remove** button (unprovisioned + deleted from DB, never on the primary domain).

## Secrets (operator prereq)

GoDaddy credentials must be in Google Secret Manager (`anchor-hub-480305`) and
wired to the `anchor-sites` Cloud Run service **and** `cloudbuild.yaml`. When
adding them, **APPEND** to the existing `--set-secrets` list — `--set-secrets`
replaces the entire list and would drop `ANCHOR_SITES_DATABASE_URL` etc. if you
overwrite instead of extend. Example:

```yaml
# cloudbuild.yaml deploy step — correct pattern (append, don't replace):
--set-secrets=ANCHOR_SITES_DATABASE_URL=...,ADMIN_API_TOKEN=...,MAILGUN_API_KEY=...,GODADDY_API_KEY=projects/.../GODADDY_API_KEY:latest,GODADDY_API_SECRET=projects/.../GODADDY_API_SECRET:latest
```

## Design decisions

- **D-050** — Pluggable `DnsProvider`. Retire the Kinsta-hardcoded DNS step;
  use `resolveDnsProvider(env)` for fallback-by-creds selection. GoDaddy as
  the default for `anchorcorps.com`; `manual` (no-op writes) for client-owned
  zones where we have no registrar API access.

- **D-051** — Two domain classes. Managed subdomains (`*.sites.anchorcorps.com`)
  are fully automated end-to-end. Client-owned custom domains require the client
  to add the surfaced DNS records at their registrar before SSL can issue;
  provisioning is non-blocking and surfaces `required_records` immediately.
