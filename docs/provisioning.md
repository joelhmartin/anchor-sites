# Tenant provisioning

Adding a new tenant subdomain (e.g. `acme-dental.sites.anchorcorps.com`)
takes one API call. The endpoint sequences the three things that have to
happen and is idempotent at every step, so it's safe to re-run.

## Architecture

```
        +-----------------------+
        |  POST /api/sites/...  |
        |   /provision          |
        +-----------+-----------+
                    |
                    v
        +-----------------------+
        |  provisionSiteHostname()
        |  src/server/provisioning/orchestrator.ts
        +-----------+-----------+
                    |
       (sequential: each step depends on the previous)
                    |
                    v
+----------------+     +----------------+     +----------------+
| 1. Postgres    | --> | 2. Cloud Run   | --> | 3. DNS provider|
|  UPSERT site_  |     |  domain mapping|     |  upsert records|
|  domains row   |     |  for hostname  |     |  (GoDaddy/etc) |
+----------------+     +----------------+     +----------------+
                              |                       |
                       (mapping reports       (records read from
                        required records)      mapping.status,
                                               then upserted)
                                                       |
                                                       v
                                              (optional 4. wait
                                               for cert ready)
```

The order matters: the Cloud Run domain mapping is created **before** the
DNS provider upsert, because the records the provider writes are read
from `mapping.status.resourceRecords` (Cloud Run tells you which records
it requires).

Same code runs in two environments:

- **From the cloud application** (admin UI, scripts, webhooks): hit
  `POST /api/sites/:siteId/provision` or `POST /api/sites/provision`
  with the admin token. The Cloud Run runtime SA holds the IAM grants
  needed for both the DNS provider + GCP REST calls.

- **From your laptop** during development: `npm run provision -- --slug=X`.
  Same orchestrator; auth comes from your local `gcloud` session + the
  `DNS_PROVIDER` env vars. Useful when you don't want to burn a build
  cycle just to provision one record.

## Configuration

The wildcard parent + registrable apex are env-controlled (see
`src/config/domain.ts`):

| Env var                       | Default                    | What it does |
| ----------------------------- | -------------------------- | ------------ |
| `SITES_DOMAIN_BASE`           | `sites.anchorcorps.com`    | The wildcard parent. `<slug>.<base>` becomes the canonical hostname. |
| `SITES_DOMAIN_REGISTRABLE`    | `anchorcorps.com`          | The registrable apex (zone the DNS records live in). Defaults to the last two labels of `BASE`; set explicitly for ccTLDs (`example.co.uk`). |

**Swapping the platform to a different domain** is a single env-var
change plus a re-seed. Set `SITES_DOMAIN_BASE=tenants.acmegroup.com` in
Cloud Run env (and `.env` for local dev), redeploy, run the seed Job,
then call provision once per site. The seed's legacy-cleanup branch
removes the old hostnames from `site_domains` automatically.

## Authentication

### DNS provider

DNS records are managed through a pluggable `DnsProvider` (see
`src/server/dns/`). The backend is selected by the `DNS_PROVIDER` env
var (`godaddy` | `manual` | `cloud-dns`).

| Env var                | Default | What it does |
| ---------------------- | ------- | ------------ |
| `DNS_PROVIDER`         | _(auto)_ | `godaddy` when GoDaddy creds are present; `manual` otherwise. `cloud-dns` is an interface-ready stub for a future Google-hosted zone. |
| `GODADDY_API_KEY`      | —       | GoDaddy production API key. Store in Secret Manager (`anchor-hub-480305`) and wire onto the `anchor-sites` Cloud Run service — same pattern as the Studio OAuth secrets. |
| `GODADDY_API_SECRET`   | —       | Matching GoDaddy API secret. |
| `GODADDY_API_BASE`     | _(GoDaddy production URL)_ | Optional override (e.g. GoDaddy OTE sandbox for testing). |

**Provisioning flow:** Cloud Run domain mapping is created first, then
`getRequiredDnsRecords` reads the records Cloud Run requires from the
mapping status (`mapping.status.resourceRecords`). Each record is
upserted through the provider (idempotent). The orchestrator then waits
for `Ready` + `CertificateProvisioned`.

**GoDaddy mode** (default when `GODADDY_API_KEY` + `GODADDY_API_SECRET`
are set): records are upserted automatically via the GoDaddy API; no
operator action required beyond wiring the secrets.

**Manual mode** (fallback when no GoDaddy creds): the orchestrator
surfaces the required records and verifies them by live DNS lookup,
leaving the actual record creation to the operator.

The Cloud Run runtime SA has `secretmanager.secretAccessor` on the
GoDaddy secrets. Local dev reads from shell env (`GODADDY_API_KEY` /
`GODADDY_API_SECRET`) or sets `DNS_PROVIDER=manual` to skip auto-upsert.

### Cloud Run domain mappings

- **Cloud Run runtime**: token from the metadata server. The runtime SA
  needs `roles/run.developer` on the project (or a custom role that
  includes `run.domainmappings.create` + `run.domainmappings.get`).
- **Local dev**: `gcloud auth print-access-token` shells out to your
  `gcloud auth login` session.

Both paths use the same regional REST endpoint
(`{region}-run.googleapis.com/apis/domains.cloudrun.com/v1/...`).

## Endpoint reference

### `POST /api/sites/:siteId/provision`

Headers: `X-Admin-Token: <ANCHOR_SITES_ADMIN_API_TOKEN>`

Body (JSON):

```json
{
  "wait": false
}
```

- `wait: true` blocks until Cloud Run reports `Ready` and
  `CertificateProvisioned` both `True`. Can take 10–20 min on first
  request because Let's Encrypt has to issue + propagate the cert.
  Default `false` — the endpoint returns immediately and the cert
  finishes in the background.

Response (200 on full success, 500 if any step errored):

```json
{
  "site_id": "...",
  "slug": "acme-dental",
  "hostname": "acme-dental.sites.anchorcorps.com",
  "steps": [
    { "step": "lookup",       "status": "ok",      "detail": "..." },
    { "step": "site_domains", "status": "ok",      "detail": "..." },
    { "step": "dns",           "status": "ok"      | "skipped", "detail": "..." },
    { "step": "cloud_run",    "status": "ok",      "detail": "...", "data": { /* mapping */ } },
    { "step": "wait_ready",   "status": "ok"      | "error",   "detail": "..." }
  ],
  "ready": true,
  "cloud_run_mapping": { "...": "..." }
}
```

### `POST /api/sites/provision` (slug-based variant)

Same handler, but body must include `slug`:

```json
{ "slug": "acme-dental", "wait": false }
```

The orchestrator resolves `slug → site_id` then runs the same steps.
Convenient when you're scripting from a shell and don't have the UUID handy.

## Local CLI

```bash
# Set up env once
cat >> .env <<'EOF'
SITES_DOMAIN_BASE=sites.anchorcorps.com
GODADDY_API_KEY=<your-godaddy-key>
GODADDY_API_SECRET=<your-godaddy-secret>
# DNS_PROVIDER=manual   # set this to skip auto-upsert and surface records manually
GCP_PROJECT_ID=anchor-hub-480305
GCP_REGION=us-central1
GCP_RUN_SERVICE=anchor-sites
EOF

# Provision a site (looks up site_id by slug)
npm run provision -- --slug=acme-dental

# Block until the cert is ready (~10-15 min on first run)
npm run provision -- --slug=acme-dental --wait

# Or use the site_id directly
npm run provision -- --site-id=1ad53457-1b9b-4938-96f5-983214ba3bf0
```

Output is human-readable; non-zero exit code if any step errored.

## Real-world example (the existing two sites)

```bash
ADMIN=$(gcloud secrets versions access latest \
  --secret=ANCHOR_SITES_ADMIN_API_TOKEN \
  --project=anchor-hub-480305)

curl -s -X POST \
  https://anchor-sites-kqikza7ska-uc.a.run.app/api/sites/provision \
  -H "X-Admin-Token: $ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"muldoon-dental"}' | jq

curl -s -X POST \
  https://anchor-sites-kqikza7ska-uc.a.run.app/api/sites/provision \
  -H "X-Admin-Token: $ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"demo-site"}' | jq
```

That's the whole workflow.

## Adding a new site

Provisioning **assumes the site already exists in the `sites` table**.
The flow today is:

1. Insert the site (currently via a one-off SQL call or the seed; a
   real admin UI lands in Phase 4).
2. Call `POST /api/sites/provision { slug }`.
3. Wait for the cert to propagate (~10–15 min).
4. Hit `https://<slug>.sites.anchorcorps.com/` and see the seeded page.

In Phase 5+, this whole flow ends up behind a single button in the
admin editor.

## Idempotency notes

Re-running the orchestrator is safe and useful:

| Step          | What re-running does |
| ------------- | -------------------- |
| `site_domains` | `INSERT ... ON CONFLICT (hostname) DO NOTHING` — no-op on second run. |
| `dns`         | Upserts each required record through the provider (idempotent); returns `status: "skipped"` if records are already correct. |
| `cloud_run`   | `createIfMissing` GETs first; returns the existing mapping on second run. |
| `wait_ready`  | Always runs; polls current state and returns once both conditions are `True`. |

Failure modes the orchestrator surfaces explicitly:

- **DNS provider not configured** (GoDaddy creds absent, `DNS_PROVIDER` not
  set) — orchestrator falls back to `manual` mode, surfaces the required
  records, and verifies by live DNS lookup. Returns `dns: error` if records
  are not yet resolvable; the operator must add them manually and re-run.
- **Cloud Run runtime SA missing `roles/run.developer`** — return with
  `cloud_run: error` and a 403 message. Grant the role, retry.
- **DNS propagation slower than expected** — `wait_ready` times out at
  the configured ceiling (default 20 min); the mapping is still created
  and will eventually finish on its own.

## Cleaning up a hostname

There's no `unprovision` endpoint yet — for now, manual cleanup:

```bash
# Delete the Cloud Run mapping
gcloud beta run domain-mappings delete \
  --domain=<hostname> \
  --region=us-central1 \
  --project=anchor-hub-480305

# Delete the DNS record through the configured provider.
# GoDaddy example (replace <zone> and <hostname> accordingly):
curl -X DELETE \
  -H "Authorization: sso-key $GODADDY_API_KEY:$GODADDY_API_SECRET" \
  "https://api.godaddy.com/v1/domains/<zone>/records/CNAME/<hostname>"

# Manual mode: remove the CNAME from whichever DNS host owns the zone.

# Optional: remove the site_domains row
psql ... -c "DELETE FROM site_domains WHERE hostname = '<hostname>';"
```

A typed `unprovisionSiteHostname()` + `DELETE /api/sites/.../provision`
endpoint lands when Phase 10 (domain provisioning at scale) needs it.

## What this does NOT do

- **It does not register a new domain.** The registrable apex must
  already exist in the DNS zone managed by your provider. (Different
  problem — that's domain registration, not DNS record management.)
- **It does not issue the SSL cert.** Cloud Run + Let's Encrypt do that
  automatically once DNS resolves; the orchestrator's `wait_ready` step
  just polls until it's done.
- **It does not handle client-owned domains** (e.g. `muldoondental.com`
  rather than `muldoon-dental.sites.anchorcorps.com`). That's Phase 10
  — the client points their NS at the DNS provider or adds CNAMEs
  themselves.
