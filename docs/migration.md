# WordPress → Anchor Sites Migration Runbook

Step-by-step guide for migrating a client site from WordPress to Anchor Sites.

---

## Pre-flight checklist

Before starting, confirm the following are ready:

| Item | Details |
|---|---|
| **CTM account** | Client has a CallTrackingMetrics account; obtain the CTM Account ID from CTM dashboard |
| **CRM credentials** | `CRM_BASE_URL` and `CRM_API_KEY` set in Cloud Run Secret Manager |
| **Analytics instance** | Plausible CE / Umami running at the URL configured in `ANALYTICS_BASE_URL` |
| **GCS bucket** | Media bucket provisioned; `GOOGLE_CLOUD_BUCKET` set in Cloud Run env |
| **DNS TTL** | Lower the client's primary domain TTL to 60s at least 24h before cutover |
| **WordPress export** | Full site export in hand (pages, posts, events, media) |

---

## Step 1: Provision the site

Run the provisioning script (creates site, subdomain, domain rows, CRM site):

```bash
DATABASE_URL=<prod-db-url> tsx scripts/provision-site.ts \
  --slug <client-slug> \
  --display-name "<Client Display Name>" \
  --ctm-account-id <ctm-id> \
  --crm
```

The script:
1. Creates the `sites` row and canonical `<slug>.sites.anchorcorps.com` subdomain
2. Creates the CRM site via `CRM_BASE_URL`/sites API (or enqueues a retry job on failure)
3. Outputs the new site UUID — record it for subsequent steps

Verify in the Studio admin:
- `GET /api/sites/<uuid>` shows the site with `crm_site_id` non-null
- `GET /api/sites/<uuid>/crm/phone-numbers` returns the client's phone numbers

---

## Step 2: Add the custom domain

In Studio → Site → Domains tab:

1. Click **Add domain** and enter the client's primary domain (e.g. `acmedental.com`).
2. For operator-owned domains (Anchor manages DNS): click **Provision** — the system creates the Cloud Run domain mapping + GoDaddy CNAME via the DNS provider.
3. For client-owned domains (client manages DNS): the UI shows the target CNAME to add. The client adds it in their registrar. Once propagated, click **Provision**.
4. Wait for SSL status to show **active** (Cloud Run issues the certificate — typically 5–15 min after DNS propagates).

---

## Step 3: Enter CTM Account ID

In Studio → Site → Settings tab:
- Fill in **CTM account ID** and save.
- The CTM script tag is now injected into every tenant page `<head>`.

---

## Step 4: Enable analytics

In Studio → Site → Settings tab:
- Ensure **Disable analytics** is unchecked (default).
- With `ANALYTICS_BASE_URL` set in Cloud Run, Plausible/Umami automatically tracks the site's canonical domain — no per-site API call needed.

---

## Step 5: Import content

For each WordPress page/post/event:

1. **Pages**: re-create in Studio editor using Puck blocks (Hero, RichText, CrmForm, etc.). For bulk import, use the pages API: `POST /api/sites/<uuid>/pages` with `{ slug, title, blocks, status }`.
2. **Posts** (blog): `POST /api/sites/<uuid>/blog` (tenant blog API).
3. **Events**: `POST /api/sites/<uuid>/events`.
4. **Media**: upload via Studio Media tab or `POST /api/sites/<uuid>/media/upload-url` → complete callback.

---

## Step 6: Domain cutover

When content is ready and SSL is active on the new domain:

1. Update the client's DNS CNAME to point at `<slug>.sites.anchorcorps.com` (if not already done in Step 2).
2. Verify propagation: `dig <client-domain> CNAME` should return the anchor subdomain.
3. Confirm the site resolves: `curl -I https://<client-domain>/` should return 200.

---

## Step 7: Smoke test

Run the smoke-test CLI:

```bash
DATABASE_URL=<prod-db-url> tsx scripts/smoke-test.ts --site-id <uuid>
```

The script verifies:
- Site resolves from the DB
- Primary domain has `ssl_status = active`
- CTM script in rendered HTML (if `ctm_account_id` set)
- Analytics script in rendered HTML (if `ANALYTICS_BASE_URL` set and `analytics_disabled = false`)
- `crm_site_id` is non-null (CRM provisioned)

Exits 0 on all green; exits 1 with a list of failures.

---

## Rollback plan

If cutover causes issues:

1. **DNS rollback**: revert the CNAME to WordPress hosting in the client's registrar. With 60s TTL, propagation completes in ~1 min.
2. **Site suspend**: `PATCH /api/sites/<uuid>` with `{ status: "suspended" }` — the site stops resolving without DNS changes.
3. **No data loss**: all Anchor Sites data persists; the migration can be retried after diagnosing the issue.

---

## Relevant env vars (Cloud Run Secret Manager)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Prod Postgres connection string |
| `CRM_BASE_URL` | Yes | CRM API base URL |
| `CRM_API_KEY` | Yes | CRM API key |
| `ANALYTICS_BASE_URL` | Recommended | Plausible/Umami instance URL |
| `ANALYTICS_PROVIDER` | No | `plausible` (default) or `umami` |
| `SENTRY_DSN` | Recommended | Error tracking |
| `WEB_VITALS_ENDPOINT` | No | `/api/vitals` or external RUM collector |
| `CSP_CRM_EXTRA_ORIGINS` | If CRM loads external scripts | Comma-separated origins |
| `GOOGLE_CLOUD_BUCKET` | Yes | GCS media bucket |
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project for Cloud Run domain mappings |
