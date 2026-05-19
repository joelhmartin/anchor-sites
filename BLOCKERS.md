# Blockers

> **Routine instructions:** Append a new blocker entry whenever you need human input to proceed. Each blocker fires a `[Builder] ⚠ Blocker:` email. Mark resolved entries with `RESOLVED <timestamp>` — do not delete.

## Format

```
### B-NNN — <one-line summary>
**Raised:** <timestamp>
**Phase/Task:** <e.g., Phase 1, Task 1.5>
**Status:** OPEN | RESOLVED <timestamp>

**What I'm trying to do:**
<context>

**What I tried:**
<attempts>

**What I need from you:**
<specific question>

**Workaround in place:**
<what the routine is doing in the meantime, if anything>
```

---

<!-- Routine appends blockers below this line -->

### B-001 — Phase 1 production deploy needs human GCP access
**Raised:** 2026-05-18 23:30 UTC
**Phase/Task:** Phase 1, Task 1.8
**Status:** PARTIALLY RESOLVED 2026-05-19 05:13 UTC — Cloud Run service is live; only domain mapping remains (B-002)

**What I'm trying to do:**
Land Task 1.8 — deploy the renderer to Cloud Run with a wildcard mapping for `*.sites.anchorcorps.com` and confirm SSL provisions and both seeded sites resolve in production. PLAN.md hard rule #9 says the first production deploy is explicitly approved as part of Phase 1.

**What I tried:**
Authored everything the routine can produce without GCP credentials:
- `Dockerfile` rewritten (multi-stage, `npm ci --omit=dev` runtime, `PORT=8080`).
- `tsx` moved from devDependencies to dependencies so `npm start` works inside the prod image.
- `cloudbuild.yaml` with build → push → run migrate job → `gcloud run deploy` substituted by `_REGION`, `_SERVICE`, `_AR_REPO`, `_SQL_INSTANCE`.
- `vercel.json` removed per D-010.
- `docs/deploy.md` walks through every `gcloud` command: API enablement, Artifact Registry repo, Cloud SQL instance + DB + user, Secret Manager secrets (DATABASE_URL / ADMIN_API_TOKEN / RESEND_API_KEY) + IAM, migration + seed jobs, Cloud Build trigger + IAM, wildcard domain mapping (with per-subdomain fallback).

**What I need from you:**
Execute the bootstrap in `docs/deploy.md` against a real GCP project. Specifically I need:
1. The chosen GCP project ID + region (the doc assumes `us-central1` and a Cloud SQL instance named `anchor-postgres` — change either if you prefer).
2. A run of step 7 ("First build") confirming the resulting Cloud Run URL serves `/healthz` with `{"ok":true,"db":true}`.
3. Step 9 — wildcard or per-subdomain domain mapping for `muldoon.sites.anchorcorps.com` and `demo.sites.anchorcorps.com`, plus the DNS records added on the registrar.
4. Step 10 confirmation: both URLs return HTML containing the seeded hero text. Paste the first ~20 lines of each curl into the chat and I'll mark the milestone.

Once both production URLs are confirmed, drop `.routine/TASK-1.8-APPROVED` and I'll tick the remaining sub-checkboxes and surface the demo-milestone in chat. Until then the routine will continue with Tasks 1.9 and 1.10 (state files + email infra, then the docs pass) — both can land without production access.

**Workaround in place:**
- Phase 1 demo milestone (Task 1.6) is already exercisable locally via `muldoon.localhost:3000` / `demo.localhost:3000` — see `DEMO-LOG.md#first-multi-tenant-page-local`.
- The routine proceeds to Task 1.9 (Resend wiring + email templates) and Task 1.10 (docs pass), so this blocker doesn't stall Phase 1 entirely.
- The Cloud Run service URL — once it exists — can be hit via `Host: muldoon.sites.anchorcorps.com` even before DNS resolves, to confirm the build is correct independent of domain mapping.

**Resolution (partial, 2026-05-19 05:13 UTC):** Cloud Run service `anchor-sites` is deployed and running.
- Service URL: `https://anchor-sites-kqikza7ska-uc.a.run.app`
- `GET /HEALTHZ` returns `{"ok":true,"db":true}` — Cloud SQL Unix-socket connection working.
- Note: `/healthz` (lowercase) is reserved by the GCP load balancer and returns Google's 404 page; `/HEALTHZ` reaches our container. Custom domains aren't subject to that path filter, so once domain mapping lands, lowercase resumes working.
- Spoofed `Host:` headers don't reach the container via the `.run.app` URL (GFE rejects unknown authorities). Validation of the per-site renderer therefore depends on the domain mapping landing (B-002).

### B-002 — Domain verification for `*.sites.anchorcorps.com`
**Raised:** 2026-05-19 05:14 UTC
**Phase/Task:** Phase 1, Task 1.8 (sub-step 4: wildcard domain mapping)
**Status:** OPEN — needs operator action in Search Console + DNS

**What I'm trying to do:**
Map `*.sites.anchorcorps.com` (or per-subdomain fallback for `muldoon.sites.anchorcorps.com` + `demo.sites.anchorcorps.com`) to the `anchor-sites` Cloud Run service so the tenant catch-all router actually receives requests with the correct Host header. Until this lands, the Phase 1 demo milestone is only locally verifiable.

**What I tried:**
`gcloud domains verify anchorcorps.com --project=anchor-hub-480305` — gcloud opens Google Search Console at `https://search.google.com/search-console/welcome?new_domain_name=anchorcorps.com`, which requires interactive sign-in + DNS TXT record placement. I cannot complete that flow headlessly.

**What I need from you:**
1. **Visit** [`https://search.google.com/search-console/welcome?new_domain_name=anchorcorps.com`](https://search.google.com/search-console/welcome?new_domain_name=anchorcorps.com) while signed in as `jmartin@anchorcorps.com` (matches the gcloud account).
2. **Choose "Domain" property type** (not URL-prefix). Paste `anchorcorps.com`.
3. Search Console will show a **TXT record** to add at your DNS host for `anchorcorps.com` — looks like `google-site-verification=<long-string>`. Add that as a TXT record at the apex (`@`).
4. After DNS propagates (usually under 5 min), click **Verify** in Search Console.
5. Drop me a line in chat ("verified") and I'll run the next two commands myself:
   - `gcloud beta run domain-mappings create --service=anchor-sites --domain='*.sites.anchorcorps.com' --region=us-central1 --project=anchor-hub-480305`
   - I'll then take the CNAME / A target records that command returns and tell you which DNS records to add for the actual hostname mapping (separate from the verification TXT).

**Workaround in place:**
- Phase 1 demo milestone remains exercisable locally on `muldoon.localhost:3000` / `demo.localhost:3000`.
- Cloud Run service is up and `/HEALTHZ` is green; admin API is reachable (401 without token, by design).
- Everything else in Phase 1 (Tasks 1.0–1.7, 1.9, 1.10) is complete.
