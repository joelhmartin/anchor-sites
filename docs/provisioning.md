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
       +------------+------------+--------------------+
       v                         v                    v
+----------------+      +----------------+    +----------------+
| 1. Postgres    |      | 2. Kinsta DNS  |    | 3. Cloud Run   |
|  UPSERT site_  |      |  CNAME ->      |    |  domain mapping|
|  domains row   |      |  ghs.google... |    |  for hostname  |
+----------------+      +----------------+    +----------------+
                                                       |
                                              (optional 4. wait
                                               for cert ready)
```

Same code runs in two environments:

- **From the cloud application** (admin UI, scripts, webhooks): hit
  `POST /api/sites/:siteId/provision` or `POST /api/sites/provision`
  with the admin token. The Cloud Run runtime SA holds the IAM grants
  needed for both Kinsta + GCP REST calls.

- **From your laptop** during development: `npm run provision -- --slug=X`.
  Same orchestrator; auth comes from your local `gcloud` session + the
  `KINSTA_API_KEY` env var. Useful when you don't want to burn a build
  cycle just to provision one record.

## Configuration

The wildcard parent + registrable apex are env-controlled (see
`src/config/domain.ts`):

| Env var                       | Default                    | What it does |
| ----------------------------- | -------------------------- | ------------ |
| `SITES_DOMAIN_BASE`           | `sites.anchorcorps.com`    | The wildcard parent. `<slug>.<base>` becomes the canonical hostname. |
| `SITES_DOMAIN_REGISTRABLE`    | `anchorcorps.com`          | The Kinsta-registered apex (zone the records live in). Defaults to the last two labels of `BASE`; set explicitly for ccTLDs (`example.co.uk`). |

**Swapping the platform to a different domain** is a single env-var
change plus a re-seed. Set `SITES_DOMAIN_BASE=tenants.acmegroup.com` in
Cloud Run env (and `.env` for local dev), redeploy, run the seed Job,
then call provision once per site. The seed's legacy-cleanup branch
removes the old hostnames from `site_domains` automatically.

## Authentication

### Kinsta DNS

- `KINSTA_API_KEY` — bearer token. Available in Secret Manager under the
  same secret name.
- `KINSTA_AGENCY_ID` — company UUID for the `?company=` query param.
  (Kinsta uses "agency" and "company" interchangeably in v2.)

The Cloud Run runtime SA has `secretmanager.secretAccessor` on both.
Local dev reads from `~/.claude/credentials/kinsta.json` (see
`scripts/provision-site.ts`) or your shell env.

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
    { "step": "kinsta",       "status": "ok"      | "skipped", "detail": "..." },
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
KINSTA_API_KEY=<your-kinsta-key>
KINSTA_AGENCY_ID=<your-kinsta-company-uuid>
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
| `kinsta`      | List records first; if a CNAME for the hostname exists, return `status: "skipped"`. |
| `cloud_run`   | `createIfMissing` GETs first; returns the existing mapping on second run. |
| `wait_ready`  | Always runs; polls current state and returns once both conditions are `True`. |

Failure modes the orchestrator surfaces explicitly:

- **No Kinsta domain registered for the registrable apex** — return early
  with `kinsta: error`. Add the domain to Kinsta first.
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

# Delete the Kinsta CNAME (note: the `name` field requires the trailing dot!)
curl -X DELETE \
  -H "Authorization: Bearer $KINSTA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<hostname>.","type":"CNAME"}' \
  https://api.kinsta.com/v2/domains/<domain-id>/dns-records

# Optional: remove the site_domains row
psql ... -c "DELETE FROM site_domains WHERE hostname = '<hostname>';"
```

A typed `unprovisionSiteHostname()` + `DELETE /api/sites/.../provision`
endpoint lands when Phase 10 (domain provisioning at scale) needs it.

## What this does NOT do

- **It does not register a new domain.** The registrable apex must
  already be in Kinsta. (Different problem — that's domain
  registration, handled by Kinsta's domain product, not the DNS API.)
- **It does not issue the SSL cert.** Cloud Run + Let's Encrypt do that
  automatically once DNS resolves; the orchestrator's `wait_ready` step
  just polls until it's done.
- **It does not handle client-owned domains** (e.g. `muldoondental.com`
  rather than `muldoon-dental.sites.anchorcorps.com`). That's Phase 10
  — the client points their NS at Kinsta or adds CNAMEs themselves.
