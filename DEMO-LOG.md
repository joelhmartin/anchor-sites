# Demo Log

> **Routine instructions:** Append an entry every time there's something visible/interactive a human can look at. Each entry fires a `[Builder] Demo ready:` email (deduped via `demo_milestones_sent` in `STATE.json`). Newest entries on top.

## Format

```
### <date> — <short title>
**Milestone ID:** <stable identifier, e.g., phase1-blockrenderer-demo>
**Phase/Task:** <e.g., Phase 1, Task 1.4>
**Commit:** <short SHA>

**What to look at:**
<URL or curl command or test page>

**What's new since last demo:**
<bullets>

**Known limitations:**
<what's intentionally not yet working>

**Next visible thing coming:**
<one line>
```

---

<!-- Routine appends demos below this line. Newest on top. -->

### 2026-05-19 — DNS records added via Kinsta API; certs issuing
**Milestone ID:** phase1-dns-live
**Phase/Task:** Phase 1, Task 1.8 (final step — domain mapping)
**Commit:** 294267b

**What's now live:**
- `muldoon.sites.anchorcorps.com` → CNAME → `ghs.googlehosted.com.` → Google IP (verified via `dig @1.1.1.1`)
- `demo.sites.anchorcorps.com` → CNAME → `ghs.googlehosted.com.` → Google IP (verified)
- Cloud Run mappings: `DomainRoutable: True` for both. Let's Encrypt cert issuance in flight (typically 10–15 min on first request).

**How:** Kinsta's public v2 API exposes record CRUD via the `/v2/domains/{id}/dns-records` endpoint (not under `/dns/*` or `/zones/*` as the docs imply). Both CNAMEs posted via the API; operation polling returned success. Public dig confirms propagation.

**Expected within ~15 min of this entry:**

```bash
curl -sI https://muldoon.sites.anchorcorps.com/    # → HTTP/2 200
curl -s  https://muldoon.sites.anchorcorps.com/ | grep "Modern dental care"
curl -s  https://demo.sites.anchorcorps.com/    | grep "Same renderer. Different site."
```

Two different sites, one renderer, all content from `pages.blocks` JSONB in `anchor-hub-480305:us-central1:anchor` → `anchor_sites_prod`. Phase 1 architectural milestone is real.

### 2026-05-19 — Domain mappings created; awaiting DNS for SSL issuance
**Milestone ID:** phase1-domain-mappings-created
**Phase/Task:** Phase 1, Task 1.8 (domain mapping step)
**Commit:** 588beca

**What's now true:**
- New image `:588beca` built + deployed (revision `anchor-sites-00003-c4l`).
- Re-seeded prod via `anchor-sites-seed` — legacy `*anchorcorps.dev` rows deleted, four new `site_domains` rows present (`muldoon.sites.anchorcorps.com`, `muldoon.localhost`, `demo.sites.anchorcorps.com`, `demo.localhost`).
- `anchorcorps.com` verified in Search Console (`gcloud domains list-user-verified` confirms).
- Per-subdomain Cloud Run domain mappings created:
  - `muldoon.sites.anchorcorps.com` → CNAME `ghs.googlehosted.com.`
  - `demo.sites.anchorcorps.com` → CNAME `ghs.googlehosted.com.`

**Blocker dropped to DNS-only:** B-002 needs two CNAME records in the DNS host that owns `anchorcorps.com`. See `BLOCKERS.md#B-002` for the exact rows.

**Once DNS propagates:**

```bash
curl -s https://muldoon.sites.anchorcorps.com/ | head -40
curl -s https://demo.sites.anchorcorps.com/   | head -40
```

Both should return 200 with the seeded hero/rich-text/cta content and per-site brand tokens — same output as the local-dev demo from 2026-05-18.

### 2026-05-19 — Cloud Run service live (deploy + DB connected; domain mapping pending)
**Milestone ID:** phase1-cloud-run-deployed
**Phase/Task:** Phase 1, Task 1.8 (Cloud Run service step)
**Commit:** 2fd737c

**What to look at:**

```bash
# Service URL (will move to *.preview.anchorcorps.dev once B-002 resolves):
URL=https://anchor-sites-kqikza7ska-uc.a.run.app

# Healthcheck — note the uppercase; lowercase /healthz is reserved by GFE.
curl -s $URL/HEALTHZ
# → {"ok":true,"db":true}

# Admin API gate (no token → 401):
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{}' \
  $URL/api/sites/x/pages/y
# → 401
```

**What's new since last demo:**
- `anchor-sites` Cloud Run service deployed in `anchor-hub-480305` / us-central1.
- Cloud SQL connection via Unix socket against the existing `anchor` instance (Postgres 15), database `anchor_sites_prod`, dedicated user `anchor_sites`.
- Migrations + seed ran successfully via Cloud Run Jobs (`anchor-sites-migrate`, `anchor-sites-seed`).
- All four secrets wired via Secret Manager: `ANCHOR_SITES_DATABASE_URL`, `ANCHOR_SITES_ADMIN_API_TOKEN`, and the three shared `MAILGUN_*` secrets.
- Image lives in `cloud-run-source-deploy:anchor-sites:2fd737c`.

**Known limitations:**
- Spoofed `Host:` headers don't reach the container via `.run.app` (GFE rejects unknown authorities). Full per-tenant rendering is only verifiable once **B-002** lands (domain verification for `anchorcorps.dev` in Search Console).
- `/healthz` (lowercase) is reserved by the GCP load balancer; we use `/HEALTHZ` for now and document it. Once a custom domain is mapped, lowercase resumes working.
- No CI trigger wired yet. Pushing to `main` does not auto-deploy; the next deploy is a manual `gcloud builds submit --config=cloudbuild.yaml`. (Wiring the GitHub trigger is deferred so the user controls when each push deploys.)

**Next visible thing coming:**
- Operator completes Search Console verification (B-002). Routine runs `gcloud beta run domain-mappings create` for `*.preview.anchorcorps.dev`, returns the CNAME/A target for DNS, and once propagated, the demo URLs `https://muldoon.preview.anchorcorps.dev` and `https://demo.preview.anchorcorps.dev` go live.

### 2026-05-18 — Phase 1 foundation complete (production deploy pending)
**Milestone ID:** phase1-complete-local
**Phase/Task:** Phase 1 (foundation) — Tasks 1.0–1.7 + 1.9–1.10 done; 1.8 blocked
**Commit:** 7222b9d

**What to look at:**

```bash
# 1. The end-to-end multi-tenant pipeline:
docker compose up -d postgres
npm run migrate:up && npm run db:seed
DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev npm run dev

curl http://muldoon.localhost:3000/      # → muldoon home (hero+rich-text+cta)
curl http://demo.localhost:3000/         # → demo site (different content + brand)

# 2. The admin save + revision flow:
export ADMIN_API_TOKEN=$(openssl rand -base64 24)
DATABASE_URL=... ADMIN_API_TOKEN=$ADMIN_API_TOKEN npm run dev  # (in another terminal)

SITE=$(psql "$DATABASE_URL" -tAc "SELECT id FROM sites WHERE slug='muldoon-dental'")
PAGE=$(psql "$DATABASE_URL" -tAc "SELECT id FROM pages WHERE slug='home' AND site_id='$SITE'")

curl -X POST "http://muldoon.localhost:3000/api/sites/$SITE/pages/$PAGE" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"blocks":[{"id":"h1","type":"hero","props":{"title":"From a save"}}]}'

curl "http://muldoon.localhost:3000/api/sites/$SITE/pages/$PAGE/revisions" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN"
```

**What's new since last demo:**
- Admin API: `POST /api/sites/:siteId/pages/:pageId` validates against the block registry, writes a `page_revisions` row atomically with the page update, returns `{ page, revision }`.
- `GET .../revisions` — reverse-chronological list.
- `POST .../revisions/:revId/restore` — non-destructive: appends a new revision tagged `source='restore:<id>'`.
- 10/min rate limit per IP; `X-Admin-Token` gated (Phase 8 swaps to Better-auth sessions).
- Resend email client wired (stub / dry-run / api modes). Templates live in `.routine/templates/`.
- Atomic `STATE.json` read/write helper with concurrent-write tests.
- Cloud Run deploy artifacts (`Dockerfile`, `cloudbuild.yaml`, `docs/deploy.md`); `vercel.json` removed per D-010.
- `README.md`, `docs/blocks.md`, `docs/data-model.md` updated for Phase 2 handoff.

**Known limitations / open work:**
- B-001 — production Cloud Run deploy needs operator GCP access. Repo-side artifacts are ready; bootstrap is in `docs/deploy.md`.
- Email "real send + receipt confirmation" sub-items in Task 1.9 stay open until a real Resend key lands during the deploy.
- The existing SPA shell (`src/components/marketing/Navbar.jsx`, `Footer.jsx`) is not yet SSR-imported. Phase 5 (Puck + full SSR per D-014) handles this.

**Next visible thing coming:**
1. Operator resolves B-001 → production URLs (`https://muldoon.preview.anchorcorps.dev`, `https://demo.preview.anchorcorps.dev`) come online.
2. Operator drops `.routine/NEXT-PHASE-APPROVED` → Phase 2 begins (versioned `@anchorcorps/components` package on GCP Artifact Registry per D-018).

### 2026-05-18 — First multi-tenant pages render from block JSON (local)
**Milestone ID:** first-multi-tenant-page-local
**Phase/Task:** Phase 1, Task 1.6
**Commit:** 1737b62

**What to look at:**

```bash
# Boot the dev server (Express + Vite middleware):
docker compose up -d postgres
npm run migrate:up && npm run db:seed
DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev npm run dev

# Two sites, one renderer, different content:
curl -s http://muldoon.localhost:3000/ | head -40
curl -s http://demo.localhost:3000/   | head -40

# 404 still wears the site shell + brand tokens:
curl -i http://muldoon.localhost:3000/nope
```

**What's new since last demo:**
- Catch-all `GET /*` route (`src/server/routes/page.ts`) resolves `Host` → site, looks up the published page, SSRs `<BlockRenderer>` in a shell with the site's brand tokens.
- Both seeded sites have real home pages (hero + rich-text + cta) in `pages.blocks` JSONB.
- Unknown hosts pass through to the Vite/SPA dev server, so `http://localhost:3000/` still loads the legacy SPA.

**Known limitations:**
- The existing `marketing/Navbar.jsx` / `Footer.jsx` shell isn't SSR-imported yet (Phase 5 + Puck per D-014 / D-017). Current shell is intentionally minimal.
- No production deployment yet — Task 1.8 maps `*.preview.anchorcorps.dev` to Cloud Run.
- No editor — Phase 5. Saves arrive in Task 1.7 (revision tracking endpoint).

**Next visible thing coming:** `POST /api/sites/:siteId/pages/:pageId` with revision history (Task 1.7), then the production URLs in Task 1.8.
