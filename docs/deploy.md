# Deployment — Google Cloud Run

Deploy target is **Cloud Run** (D-010 — Vercel was rejected because the
multi-tenant Host-header routing requires a long-running Node server and
wildcard subdomain mapping with managed SSL).

The repo ships:

- `Dockerfile` — multi-stage build, runtime stage uses `npm ci --omit=dev`.
- `cloudbuild.yaml` — image build → push → migrate → deploy pipeline.
- `.dockerignore` — keeps `.routine/`, `node_modules`, `.env*`, and tests out
  of the image.

The routine cannot execute any of the GCP-side bootstrap itself (no service
account creds in this workspace). The steps below are intended for a human
operator with `roles/owner` (or the equivalent split of admin / Cloud SQL
admin / Artifact Registry admin / Cloud Run admin / Secret Manager admin)
on the target GCP project. They run **once** to bootstrap; CI takes over
after that.

---

## 0 — Prerequisites you provide

| Item                          | Example                                       |
| ----------------------------- | --------------------------------------------- |
| GCP project ID                | `anchorcorps-builder-prod`                    |
| Cloud SQL Postgres instance   | `anchor-postgres` in `us-central1`            |
| Cloud SQL DB + user           | DB `anchor_prod`, user `anchor` (strong pw)   |
| Artifact Registry repo (Docker) | `anchor` in `us-central1`                   |
| Domain you control            | `anchorcorps.dev` (Route53 / Cloud DNS / etc) |
| `gcloud auth login` + `gcloud config set project ...` done             |

All commands below assume those are populated. Replace placeholders before pasting.

---

## 1 — Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  domains.googleapis.com
```

## 2 — Artifact Registry

```bash
gcloud artifacts repositories create anchor \
  --repository-format=docker \
  --location=us-central1 \
  --description="AnchorCorps Site Builder images"
```

## 3 — Cloud SQL Postgres

```bash
gcloud sql instances create anchor-postgres \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --tier=db-custom-2-7680 \
  --availability-type=zonal \
  --storage-auto-increase

gcloud sql databases create anchor_prod --instance=anchor-postgres
gcloud sql users create anchor --instance=anchor-postgres --password='REPLACE_ME'
```

> Connection from Cloud Run uses the Cloud SQL Unix socket — no VPC required.
> The socket path is `/cloudsql/$PROJECT_ID:us-central1:anchor-postgres`.

## 4 — Secrets

The deploy step injects three secrets via `--set-secrets`:

```bash
# DATABASE_URL — note the host=/cloudsql/... form
printf 'postgres://anchor:REPLACE_ME@/anchor_prod?host=/cloudsql/PROJECT_ID:us-central1:anchor-postgres' \
  | gcloud secrets create DATABASE_URL --data-file=-

# ADMIN_API_TOKEN — opaque string; the editor / curl uses this via X-Admin-Token
openssl rand -base64 48 | gcloud secrets create ADMIN_API_TOKEN --data-file=-

# RESEND_API_KEY — placeholder until Task 1.9 wires Resend
printf 'placeholder' | gcloud secrets create RESEND_API_KEY --data-file=-
```

Grant the Cloud Run service account `roles/secretmanager.secretAccessor`:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for secret in DATABASE_URL ADMIN_API_TOKEN RESEND_API_KEY; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

## 5 — Migration job

Migrations run once per deploy via a Cloud Run **Job** named
`anchor-sites-migrate`. Create it once; the build pipeline triggers it.

```bash
gcloud run jobs create anchor-sites-migrate \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/anchor/anchor-sites:bootstrap \
  --region=us-central1 \
  --command="npm" \
  --args="run,migrate:up" \
  --add-cloudsql-instances="$(gcloud config get-value project):us-central1:anchor-postgres" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --max-retries=1 \
  --task-timeout=300s
```

> The `:bootstrap` tag is a placeholder so the job exists before the first
> build. CI updates the image tag on every run via
> `gcloud run jobs update ... --image=...:$SHORT_SHA` if you want it pinned
> to the current build (optional — using `:latest` is fine).

## 6 — Cloud Build trigger

```bash
gcloud builds triggers create github \
  --name=anchor-sites-main \
  --repo-owner=joelhmartin \
  --repo-name=anchor-sites \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml
```

Grant Cloud Build the roles it needs:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role=roles/run.admin
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role=roles/iam.serviceAccountUser
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role=roles/cloudsql.client
```

## 7 — First build

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_SQL_INSTANCE=$(gcloud config get-value project):us-central1:anchor-postgres
```

When this finishes:

```bash
gcloud run services describe anchor-sites --region=us-central1 --format='value(status.url)'
# https://anchor-sites-<hash>-uc.a.run.app
```

`curl <that url>/healthz` should return `{"ok":true,"db":true}`.

## 8 — Seed the prod DB

The migration job populates the schema. Seeding (sites + pages + domains)
is a separate one-off:

```bash
gcloud run jobs create anchor-sites-seed \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/anchor/anchor-sites:latest \
  --region=us-central1 \
  --command="npm" \
  --args="run,db:seed" \
  --add-cloudsql-instances="$(gcloud config get-value project):us-central1:anchor-postgres" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --max-retries=0 \
  --task-timeout=300s

gcloud run jobs execute anchor-sites-seed --region=us-central1 --wait
```

The seed inserts `muldoon.preview.anchorcorps.dev` and
`demo.preview.anchorcorps.dev` into `site_domains`, so once the wildcard
domain is mapped (step 9) both hostnames will resolve.

## 9 — Wildcard domain mapping

```bash
# Verify domain ownership in Search Console first:
# https://search.google.com/search-console/welcome
# (TXT record on the registrar side.)

gcloud beta run domain-mappings create \
  --service=anchor-sites \
  --domain='*.preview.anchorcorps.dev' \
  --region=us-central1
```

If wildcard mapping returns "not supported in region", fall back to
per-subdomain mappings for the two seeded sites and log a blocker:

```bash
for sub in muldoon.preview.anchorcorps.dev demo.preview.anchorcorps.dev; do
  gcloud beta run domain-mappings create \
    --service=anchor-sites --domain=$sub --region=us-central1
done
```

Take the CNAME / A record values from the returned `kind: ResourceRecord`
and add them to your DNS provider. Cloud Run provisions SSL certs
automatically once DNS resolves.

## 10 — Confirm the demo URLs

```bash
curl -s https://muldoon.preview.anchorcorps.dev/ | head -40
curl -s https://demo.preview.anchorcorps.dev/   | head -40
```

Both should return real HTML with the seeded hero / rich-text / cta
blocks and the site's brand tokens in `<style>`.

---

## Rollback

```bash
# List recent revisions:
gcloud run revisions list --service=anchor-sites --region=us-central1

# Send all traffic to a known-good revision:
gcloud run services update-traffic anchor-sites \
  --to-revisions=<revision-name>=100 \
  --region=us-central1
```

Cloud Build keeps every image tag (`:$SHORT_SHA`) so rolling back is just
a service update — no rebuild required.

---

## What's NOT in scope for Task 1.8

- **Resend email wiring** — Task 1.9.
- **Real analytics** — Phase 12 (Plausible CE per D-021).
- **Custom-domain provisioning per client** — Phase 10.
- **Bot / abuse protection** — Phase 12 hardening.
