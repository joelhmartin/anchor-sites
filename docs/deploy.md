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
| Domain you control            | `anchorcorps.com` (Route53 / Cloud DNS / etc) |
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

**As of this SDD round the deploy step's `--set-secrets` (the `deploy` step in
`cloudbuild.yaml`) injects 17 secrets, not three, and there is no
`RESEND_API_KEY`** — transactional email is Mailgun (D-023), shared with
anchor-hub, not Resend; the "Resend" name only ever existed in this doc as a
Task 1.8-era placeholder that was never wired up. Enumerated straight from
`cloudbuild.yaml`'s `deploy` step (`ENV_VAR_NAME=SECRET_NAME:latest` pairs):

| Env var (what the app reads) | Secret Manager name | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `ANCHOR_SITES_DATABASE_URL` | `postgres:///...?host=/cloudsql/...` — Cloud SQL Unix socket. |
| `ADMIN_API_TOKEN` | `ANCHOR_SITES_ADMIN_API_TOKEN` | Opaque string; `X-Admin-Token` header. |
| `MAILGUN_API_KEY` | `MAILGUN_API_KEY` | Shared with anchor-hub. |
| `MAILGUN_DOMAIN` | `MAILGUN_DOMAIN` | Shared with anchor-hub. |
| `MAILGUN_DEFAULT_FROM` | `MAILGUN_DEFAULT_FROM` | Shared with anchor-hub. |
| `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` | Studio Google OAuth web client (D-034). |
| `GOOGLE_CLIENT_SECRET` | `GOOGLE_CLIENT_SECRET` | Studio Google OAuth secret. |
| `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET` | 32+ random bytes; Studio session signing. |
| `GODADDY_API_KEY` | `GODADDY_API_KEY` | Shared project-wide (`docs/security.md`). |
| `GODADDY_API_SECRET` | `GODADDY_API_SECRET` | Shared project-wide. |
| `KINSTA_API_KEY` | `KINSTA_API_KEY` | DnsProvider — anchorcorps.com's real zone lives on Kinsta (§9 below). |
| `KINSTA_COMPANY_ID` | `KINSTA_AGENCY_ID` | Note the name mismatch: the app's env var is `KINSTA_COMPANY_ID`, the Secret Manager secret is `KINSTA_AGENCY_ID` (same value — the Kinsta API just calls it "company"). |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | AI site agent (`docs/ai-agent.md`); unset → stub mode. |
| `PIXABAY_API_KEY` | `PIXABAY_API_KEY` | Stock image search/import; unset → deterministic stub hits. |
| `PLUGIN_CONFIG_ENC_KEY` | `PLUGIN_CONFIG_ENC_KEY` | **Must be base64**, not hex — `openssl rand -base64 32`, must decode to exactly 32 bytes (`docs/plugins.md`). |
| `GITHUB_CONTENT_TOKEN` | `GITHUB_CONTENT_TOKEN` | GitHub sync (`docs/github-sync.md`); placeholder `"disabled"` until a real fine-grained PAT is set. |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_WEBHOOK_SECRET` | GitHub sync push-webhook HMAC secret; same placeholder convention. |

Only the two secrets isolating this service's own data from anchor-hub's
(`DATABASE_URL`, `ADMIN_API_TOKEN`) use the `ANCHOR_SITES_*` naming — every
other secret above is either genuinely shared across services (Mailgun,
GoDaddy) or just doesn't collide with anything in anchor-hub's own secret
namespace, so it kept its bare name.

```bash
# DATABASE_URL — note the host=/cloudsql/... form
printf 'postgres://anchor:REPLACE_ME@/anchor_prod?host=/cloudsql/PROJECT_ID:us-central1:anchor-postgres' \
  | gcloud secrets create ANCHOR_SITES_DATABASE_URL --data-file=-

# ADMIN_API_TOKEN — opaque string; the editor / curl uses this via X-Admin-Token
openssl rand -base64 48 | gcloud secrets create ANCHOR_SITES_ADMIN_API_TOKEN --data-file=-
```

The other 15 secrets in the table above are provisioned the same way
(`gcloud secrets create <SECRET_NAME> --data-file=-`) as each integration is
wired up — see the table's "Notes" column for the value each one expects.

Grant the Cloud Run service account `roles/secretmanager.secretAccessor` on
every secret name in the table above:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for secret in ANCHOR_SITES_DATABASE_URL ANCHOR_SITES_ADMIN_API_TOKEN \
  MAILGUN_API_KEY MAILGUN_DOMAIN MAILGUN_DEFAULT_FROM \
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET BETTER_AUTH_SECRET \
  GODADDY_API_KEY GODADDY_API_SECRET KINSTA_API_KEY KINSTA_AGENCY_ID \
  ANTHROPIC_API_KEY PIXABAY_API_KEY PLUGIN_CONFIG_ENC_KEY \
  GITHUB_CONTENT_TOKEN GITHUB_WEBHOOK_SECRET; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

> **`--set-secrets` REPLACES the entire secret list on every deploy — it does
> not merge with what's already on the running revision.** Any secret name
> missing from `cloudbuild.yaml`'s `deploy` step's `--set-secrets` value is
> silently dropped from the next revision, even if you added it manually with
> `gcloud run services update` in between deploys. A manual patch to add or
> fix a secret binding **always lapses on the next CI deploy** unless the same
> change also lands in `cloudbuild.yaml` — this caused a real OAuth outage
> (Studio Google sign-in silently stopped working after a deploy that didn't
> know about a manually-added secret) and a real domain-provisioning outage
> for tmj-new-england (same gotcha, for `--set-env-vars`, which has the
> identical replace-not-merge behavior — see the `deploy` step's inline
> comment in `cloudbuild.yaml`). **The fix is always the same: edit
> `cloudbuild.yaml`, never `gcloud run services update` alone.**

## 5 — Migration job

Migrations (and built-in template seeding) run once per deploy via a Cloud Run
**Job** named `anchor-sites-migrate`. Create it once; the build pipeline
triggers it. The job runs `npm run deploy:db` = `migrate:up && db:seed-templates`,
so every deploy applies pending migrations AND upserts the built-in "Starter"
template (idempotent, scoped to the `starter` slug — it never recreates demo
tenant sites or touches user-created templates). `cloudbuild.yaml`'s
`migrate-image` step re-asserts `--command/--args` **and `--set-secrets`** on
every build, so even if the job is recreated with a different command or a
stale secret list it self-corrects on the next deploy.

The job needs two secrets, not one: `DATABASE_URL` for the migration itself,
and `PIXABAY_API_KEY` because `db:seed-templates` ingests real cover images
for the template gallery (through the standard media pipeline, under the
system-templates site) — without it, seeding still succeeds but falls back to
Pixabay's stub behavior instead of real imagery.

```bash
gcloud run jobs create anchor-sites-migrate \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/anchor/anchor-sites:bootstrap \
  --region=us-central1 \
  --command="npm" \
  --args="run,deploy:db" \
  --add-cloudsql-instances="$(gcloud config get-value project):us-central1:anchor-postgres" \
  --set-secrets=DATABASE_URL=ANCHOR_SITES_DATABASE_URL:latest,PIXABAY_API_KEY=PIXABAY_API_KEY:latest \
  --max-retries=1 \
  --task-timeout=300s
```

> The `:bootstrap` tag is a placeholder so the job exists before the first
> build. CI updates the image tag, command, and `--set-secrets` on every run
> via the `migrate-image` step (`gcloud run jobs update ... --image=...:$SHORT_SHA
> --command=npm --args=run,deploy:db --set-secrets=...`), so the job always
> runs the freshly-built image with the right command and secrets — remember
> the same replace-not-merge gotcha from §4 applies here too: if you ever add
> a secret this job needs, add it to `cloudbuild.yaml`'s `migrate-image` step,
> not just to the job directly with `gcloud`.

## 5b — `--no-cpu-throttling` (background AI agent jobs need always-on CPU)

The `deploy` step's `gcloud run deploy` call in `cloudbuild.yaml` passes
`--no-cpu-throttling`. **This is required, not an optimization** — leaving it
off breaks the AI site agent in production:

Cloud Run's default CPU allocation is **request-scoped**: an instance's CPU
gets throttled to near-zero the moment there's no in-flight HTTP request
being served on it, even while the instance itself stays warm. The AI agent's
turns (`docs/ai-agent.md`) do NOT run inside a request — every turn is an
`ai.agent-turn` pg-boss job running in the background, polling Postgres and
calling the Anthropic API for however long the build takes, with nobody
necessarily watching an open HTTP connection to that instance the whole time.
Under default (request-scoped) CPU, a job like that gets starved mid-run:
observed failure mode was DB keepalives timing out and pg-boss connections
dying with "Connection terminated" storms, plus a continuation round erroring
outright when the CPU was throttled during an in-flight Anthropic call.
`--no-cpu-throttling` allocates CPU to the instance continuously (as long as
it's running), not just while serving a request, so a background turn keeps
making real progress with no open tab watching it.

## 6 — Cloud Build trigger

> **Do NOT use `gcloud builds triggers create github`** here. In this project
> that command returns a bare `INVALID_ARGUMENT` for *every* repo (verified
> 2026-05-20 — it fails even for the already-connected `ai-endpoint`), so it's a
> useless diagnostic. Import the trigger proto instead (`cloudbuild-trigger.yaml`).

**6a — Connect the repo (one-time, Console — interactive GitHub OAuth).** The
Cloud Build GitHub App being installed on GitHub is *not* sufficient; this GCP
project also needs a **repository mapping** for `joelhmartin/anchor-sites`. If
step 6b returns `FAILED_PRECONDITION: Repository mapping does not exist`, open:

```
https://console.cloud.google.com/cloud-build/triggers;region=global/connect?project=333281424614
```

Choose **GitHub (Cloud Build GitHub App)** → authorize if prompted → select
**joelhmartin/anchor-sites** → **Connect**. (The OAuth handshake can't be done
from the CLI — this is the one manual step.)

**6b — Import the trigger** (repeatable; safe to re-run):

```bash
gcloud builds triggers import --source=cloudbuild-trigger.yaml --region=global
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

> **Built-in templates seed automatically.** `db:seed-templates` (the "Starter"
> template) runs as part of the migrate job on every deploy (see §5), so you
> don't seed it by hand. The step below is only the **tenant demo-site** seed
> (`db:seed` → muldoon/demo sites + pages + domains), which is deliberately
> NOT in the pipeline — it's a one-off bootstrap you run only if you actually
> want those demo tenants in this environment.

The migration job populates the schema. The tenant demo-site seed (sites +
pages + domains) is a separate one-off:

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

The seed inserts `muldoon.sites.anchorcorps.com` and
`demo.sites.anchorcorps.com` into `site_domains`, so once the wildcard
domain is mapped (step 9) both hostnames will resolve.

## 9 — Wildcard domain mapping

```bash
# Verify domain ownership in Search Console first:
# https://search.google.com/search-console/welcome
# (TXT record on the registrar side.)

gcloud beta run domain-mappings create \
  --service=anchor-sites \
  --domain='*.sites.anchorcorps.com' \
  --region=us-central1
```

If wildcard mapping returns "not supported in region", fall back to
per-subdomain mappings for the two seeded sites and log a blocker:

```bash
for sub in muldoon.sites.anchorcorps.com demo.sites.anchorcorps.com; do
  gcloud beta run domain-mappings create \
    --service=anchor-sites --domain=$sub --region=us-central1
done
```

Take the CNAME / A record values from the returned `kind: ResourceRecord`
and add them to your DNS provider. Cloud Run provisions SSL certs
automatically once DNS resolves.

### Known limitation — Webmaster Central verification gates auto-provisioning (Task D1)

Every domain mapping Cloud Run creates — whether from this manual step, the
admin "Provision" button, or the automatic `site.provision` job that now
fires on site creation (see below) — is rejected with `PermissionDenied`
until the **runtime service account**,
`333281424614-compute@developer.gserviceaccount.com`, is added as a
**verified owner of `anchorcorps.com`** in [Google Search Console /
Webmaster Central](https://search.google.com/search-console/welcome). This
is a **one-time operator action** (Search Console → add owner → paste the
service account email), separate from the TXT-record domain verification
above, which only proves *a* human controls the domain — Cloud Run's domain
mappings API separately requires the *calling identity* to be a verified
owner before it will mint a mapping + managed cert for a new hostname.

Until that's done:

- `provisionSiteHostname`'s `cloud_run` step fails cleanly with a
  `PermissionDenied` detail string (never an unhandled crash).
- The `site.provision` job (Task D1) records this as `verification_status =
  'failed'` / `ssl_status = 'failed'` on the domain row and retries a few
  times (`retryLimit: 5`, backoff) before giving up — so once the operator
  completes the one-time verification, the next automatic retry (or a
  manual "Provision" click) succeeds without any code change.
- The DNS step is unaffected either way, but **not** because it's a no-op:
  `KinstaDnsProvider.ensureRecord` matches records by exact `(type, name)`,
  so a literal per-site hostname (e.g. `acme.sites.anchorcorps.com`) never
  matches the zone's `*.sites.anchorcorps.com` wildcard record — every new
  site's DNS step issues a **real `POST`** creating its own literal CNAME,
  which then coexists with the wildcard. This is idempotent per-site
  (re-running for the same site finds its own record and no-ops), but a
  creation burst (more than Kinsta's 5 req/min resource-creation limit) can
  hit a 429/rate-limit error — that's exactly the case the job's
  `retryLimit: 5` / 60s backoff exists to self-heal, not a real failure.

### Kinsta DNS provider (Task D1) — auto-provisioning on site create

`anchorcorps.com`'s DNS zone lives on **Kinsta DNS** (Route 53 under the
hood — GoDaddy has no zone file for it and 404s `UNKNOWN_DOMAIN`). Set
`KINSTA_API_KEY` / `KINSTA_COMPANY_ID` (Secret Manager: `KINSTA_API_KEY`,
`KINSTA_AGENCY_ID` — see cloudbuild.yaml's `--set-secrets`) and
`resolveDnsProvider()` picks Kinsta by default (it outranks GoDaddy in the
no-`DNS_PROVIDER`-set precedence, since Kinsta is where the real zone is).
Force a specific provider with `DNS_PROVIDER=kinsta|godaddy|manual|cloud-dns`.

Every site creation (the new-site wizard and the create-from-template flow —
both funnel through `createSiteWithDomains`) now enqueues a `site.provision`
pg-boss job (`singletonKey` = the canonical domain row's id) right after the
site + its `<slug>.sites.anchorcorps.com` domain row commit. The job reuses
`provisionSiteHostname` (`src/server/provisioning/orchestrator.ts`) — the
same orchestration the admin "Provision" endpoints call — so there's exactly
one Cloud Run + DNS step sequence in the codebase. Site creation itself never
blocks or fails on this: enqueue failures (pg-boss not booted) are swallowed,
and job failures land on the domain row's own status fields rather than
surfacing as an API error, per the known limitation above.

## 10 — Confirm the demo URLs

```bash
curl -s https://muldoon.sites.anchorcorps.com/ | head -40
curl -s https://demo.sites.anchorcorps.com/   | head -40
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

- **Real analytics** — Phase 12 (Plausible CE per D-021).
- **Custom-domain provisioning per client** — Phase 10.
- **Bot / abuse protection** — Phase 12 hardening.
