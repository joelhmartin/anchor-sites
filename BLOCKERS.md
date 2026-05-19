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
**Status:** OPEN

**What I'm trying to do:**
Land Task 1.8 — deploy the renderer to Cloud Run with a wildcard mapping for `*.preview.anchorcorps.dev` and confirm SSL provisions and both seeded sites resolve in production. PLAN.md hard rule #9 says the first production deploy is explicitly approved as part of Phase 1.

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
3. Step 9 — wildcard or per-subdomain domain mapping for `muldoon.preview.anchorcorps.dev` and `demo.preview.anchorcorps.dev`, plus the DNS records added on the registrar.
4. Step 10 confirmation: both URLs return HTML containing the seeded hero text. Paste the first ~20 lines of each curl into the chat and I'll mark the milestone.

Once both production URLs are confirmed, drop `.routine/TASK-1.8-APPROVED` and I'll tick the remaining sub-checkboxes and surface the demo-milestone in chat. Until then the routine will continue with Tasks 1.9 and 1.10 (state files + email infra, then the docs pass) — both can land without production access.

**Workaround in place:**
- Phase 1 demo milestone (Task 1.6) is already exercisable locally via `muldoon.localhost:3000` / `demo.localhost:3000` — see `DEMO-LOG.md#first-multi-tenant-page-local`.
- The routine proceeds to Task 1.9 (Resend wiring + email templates) and Task 1.10 (docs pass), so this blocker doesn't stall Phase 1 entirely.
- The Cloud Run service URL — once it exists — can be hit via `Host: muldoon.preview.anchorcorps.dev` even before DNS resolves, to confirm the build is correct independent of domain mapping.
