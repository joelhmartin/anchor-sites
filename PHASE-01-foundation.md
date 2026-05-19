# Phase 1 — Foundation: Block Schema + Renderer + First Live Multi-Tenant Site

> **Goal of this phase:** By the end, a request to `muldoon.preview.anchorcorps.dev` returns a real React-rendered page whose entire content tree comes from `pages.blocks` JSONB in Postgres, using a Zod-validated block registry. The existing auth/blog/events flows still work. Three real block types render (Hero, RichText, CTA). The admin can switch between two seeded sites via Host header. **No editor UI yet** — that's Phase 5. This phase proves the data model and rendering pipeline.

> **Estimated duration:** 4–6 routine work blocks (~2–3 days at steady cadence)

> **Pre-flight check:** Before starting, verify the existing app still boots. **Note (D-011):** the starting repo is a Vite + React SPA with no Express server, no Postgres, and no auth/blog/events. Task 1.0 (added) stands up that backend before Task 1.1 captures the baseline. The "existing functionality" safety net referenced throughout this phase is established by Task 1.0 + 1.1, not pre-existing.

---

## Task 1.0 — Backend scaffold (added per D-011)

> **Why this exists:** The starting repo has no backend. PLAN.md and the rest of Phase 1 assume an Express + Postgres app exists. Task 1.0 closes that gap.

> **Expansion required:** This task is a stub. On the first run, expand it into a detailed sub-task list, email the user a summary, and wait for `.routine/TASK-1.0-APPROVED` before writing code. Do not guess the shape of the backend without confirmation.

**Stub sub-tasks (expanded and approved 2026-05-18, see `.routine/TASK-1.0-APPROVED`):**

- [x] Add Express server (`src/server/index.ts` + `src/server/app.ts`) — Vite mounted as middleware (D-014), single process
- [x] Add `pg` dependency and Postgres connection pool (`src/server/db.ts` with `ping()` helper)
- [x] Add `node-pg-migrate` with `db/migrations/` directory; initial migration enables `pgcrypto`. Scripts `migrate:up` / `migrate:down`
- [x] Add `/healthz` route returning `{ ok: true, db: <bool> }`
- [x] Add `src/server/email/send.ts` stub (Resend interface only; Task 1.9 wires real send)
- [x] Add `Dockerfile` skeleton + `.dockerignore` (full Cloud Run config lands in Task 1.8)
- [x] Update `package.json` scripts: `dev`, `build`, `start`, `preview`, `test`, `typecheck`, `migrate:up`, `migrate:down`
- [x] Add TypeScript: `tsconfig.json`, `tsx`, `typescript`, `@types/*` (D-015 — server in TS, client stays JSX)
- [x] Add `docker-compose.yml` (Postgres 16) and `.env.example`
- [x] Append `DECISIONS.md` D-013 (local Docker Compose Postgres, Cloud SQL in prod)
- [x] Append `DECISIONS.md` D-014 (Express + Vite middleware mode)
- [x] Append `DECISIONS.md` D-015 (TS adoption scope)

**Tests:**
- [x] `GET /healthz` returns 200 with `{ ok: true }`
- [x] Unknown route returns 404
- [x] DB pool query works (skipped when `DATABASE_URL` unset — runs on CI with DB)
- [ ] Migration up + down runs cleanly on empty DB *(manual verification — automated test deferred; requires running Postgres in test env)*

**Email trigger:** Skipped — email infra not wired until Task 1.9. Surfacing in chat / completion log instead.

---

## Task 1.1 — Pre-flight: snapshot existing functionality

> **Updated per D-011:** Original wording referenced auth/blog/events which do not exist in this repo. Baseline now covers what Task 1.0 produced.

- [x] Run the app locally (Express + Vite), confirm `/healthz` returns 200 and the SPA index loads
- [x] Run the test suite, capture passing baseline in `.routine/baseline-tests.log`
- [x] Create `tests/smoke/baseline.test.ts` with at minimum:
  - [x] `GET /healthz` returns 200
  - [x] SPA index returns 200 with non-empty HTML *(in `tests/smoke/spa.test.ts` — boots real Vite middleware)*
  - [x] DB pool connects successfully *(skipped without `DATABASE_URL`, runs on CI with DB)*
- [x] Commit baseline tests: `chore(P1-T1.1): baseline smoke tests before builder work`
- [ ] **Email trigger:** Skipped — email infra not wired until Task 1.9. Surfacing in chat / completion log instead.

**Why this matters:** Every subsequent task should keep these tests green. If a change breaks them, stop and either fix or escalate to `BLOCKERS.md`. Do not proceed with broken baselines.

---

## Task 1.2 — Postgres schema for sites, pages, revisions

- [x] Create migration `db/migrations/1747571000000_sites_pages_revisions.cjs` with:
  - [x] `sites` table (id UUID PK, slug TEXT UNIQUE, display_name, status, default_brand_tokens JSONB, created_at)
  - [x] `site_domains` table (id, site_id FK, hostname UNIQUE, is_primary, verification_status, ssl_status, created_at) — *populated by Phase 10, schema now*
  - [x] `pages` table (id UUID PK, site_id FK, slug, title, blocks JSONB DEFAULT `'[]'`, seo JSONB DEFAULT `'{}'`, status TEXT DEFAULT 'draft', published_at, created_at, updated_at, UNIQUE(site_id, slug))
  - [x] `page_revisions` table (id UUID PK, page_id FK ON DELETE CASCADE, blocks JSONB, seo JSONB, author_id, source TEXT, created_at)
  - [x] Index on `pages(site_id, slug)` *(via UNIQUE constraint)* and `pages(site_id, status)`
  - [x] GIN index on `pages.blocks` for future structural queries
  - [x] Shared `touch_updated_at()` trigger function + `pages_touch_updated_at` trigger
  - [x] CHECK constraints on `sites.status`, `site_domains.verification_status`, `site_domains.ssl_status`, `pages.status`
- [x] Apply migration in dev
- [x] Write rollback migration *(in same file — `exports.down`)*
- [x] Seed two sites: `muldoon-dental` and `demo-site` with placeholder display names
- [x] Seed one home page per site with an empty `blocks: []` for now
- [x] Document the schema in `docs/data-model.md`
- [x] *(Decision already captured: D-001 in DECISIONS.md covers "JSONB blocks array, not normalized block rows" — no duplicate append needed)*

**Tests:**
- [x] Migration runs cleanly forward and backward *(tests/integration/schema.test.ts — `migrate down then up` test)*
- [x] Seed script is idempotent (re-running doesn't duplicate) *(tests/integration/seed.test.ts)*
- [x] Bonus: cascade delete from `pages` removes `page_revisions`; `updated_at` trigger fires; CHECK constraints reject bad statuses

---

## Task 1.3 — Block registry pattern (the core abstraction)

This is the keystone of the whole builder. Get it right or everything else is harder.

- [ ] Create `src/blocks/` directory
- [ ] Create `src/blocks/types.ts` with the base `Block` type:
  ```ts
  type Block = {
    id: string;            // nanoid
    type: string;          // registry key
    props: Record<string, unknown>;
    children?: Block[];
  };
  ```
- [ ] Create `src/blocks/registry.ts` exporting both a `blockRegistry` map AND a `registerBlock(entry)` function. Static blocks in `src/blocks/<type>/` call `registerBlock` themselves at module load. **Per D-016**, this keeps the same API available to plugins later — they call `registerBlock` from their manifest's load step. Do not hardcode a static map.
- [ ] Add Zod dependency, set up `zod-to-json-schema` for later AI use
- [ ] Create three block types in their own folders:
  - [ ] `src/blocks/hero/` — schema.ts, component.tsx, index.ts
  - [ ] `src/blocks/rich-text/` — schema.ts, component.tsx, index.ts (uses dangerouslySetInnerHTML for now; Tiptap comes in Phase 5)
  - [ ] `src/blocks/cta/` — schema.ts, component.tsx, index.ts
- [ ] Each block component must:
  - [ ] Use `ac-` class prefix exclusively
  - [ ] Use CSS custom properties for colors (`var(--theme-main)`, `var(--theme-accent)`)
  - [ ] Not declare `font-family` in its CSS
  - [ ] Be a pure function of props (no internal state)
- [ ] Each schema must include sensible defaults via Zod's `.default()` so partial props still validate
- [ ] Export the registry from `src/blocks/index.ts`

**Tests:**
- [ ] Each block schema validates a valid props object and rejects an invalid one
- [ ] Registry lookup by type returns the expected entry
- [ ] All three components render without crashing given valid props

---

## Task 1.4 — BlockRenderer component

- [ ] Create `src/components/BlockRenderer.tsx`:
  ```tsx
  type Props = { blocks: Block[]; editable?: boolean };
  ```
- [ ] For each block:
  - [ ] Look up registry entry, render `<UnknownBlock>` placeholder if type not found
  - [ ] Validate `props` with the registry schema
  - [ ] On validation failure, render `<BlockError>` showing the error in dev, silent placeholder in prod
  - [ ] On success, render the component with parsed props
  - [ ] Pass `block.id` as React key
- [ ] Create `<UnknownBlock>` and `<BlockError>` fallback components
- [ ] Add `data-block-id` and `data-block-type` attributes on each rendered block's root element (needed for editor in Phase 5, set up now)
- [ ] Create a Storybook-style harness route at `/__blocks/preview` that lets you POST a blocks array and see it render — gated to admin in dev only

**Tests:**
- [ ] Renderer handles empty array
- [ ] Renderer handles unknown block type without crashing
- [ ] Renderer handles invalid props without crashing
- [ ] Renderer renders three known blocks in order with correct keys

**Demo milestone:** Once `/__blocks/preview` works, you can POST a JSON blocks array and see it render. **Email trigger:** "Block renderer is live — try posting to /__blocks/preview" with example curl.

---

## Task 1.5 — Multi-tenant request resolution

- [ ] Create middleware `src/middleware/resolveSite.ts`:
  - [ ] Read `Host` header
  - [ ] Strip port if present
  - [ ] Look up `site_domains` for matching hostname → `site_id`
  - [ ] Fallback: parse subdomain from `*.preview.anchorcorps.dev` or `*.anchorcorps.dev` → match `sites.slug`
  - [ ] Attach `req.site` to the request — type includes `plugins: PluginInstance[]` (empty array in Phase 1; field reserved per D-016 so Phase 7.5 doesn't have to retrofit)
  - [ ] Return 404 site-not-found page if no match
- [ ] Cache the host→site lookup in-memory with a 60s TTL (per-process Map is fine for now; Redis later)
- [ ] Mount middleware on all routes *except* the existing admin/auth/blog routes (those stay tenant-less for now — they'll be tenant-aware in Phase 8)
- [ ] Update local dev: add `/etc/hosts` instructions to `docs/local-dev.md` for `muldoon.localhost` and `demo.localhost`

**Tests:**
- [ ] Request with `Host: muldoon.preview.anchorcorps.dev` resolves to muldoon site
- [ ] Request with `Host: demo.preview.anchorcorps.dev` resolves to demo site
- [ ] Request with unknown host returns 404
- [ ] Existing auth route still works (not tenant-scoped yet)

---

## Task 1.6 — Page rendering route

- [ ] Create route `GET /:slug*` (catch-all, registered *after* all existing routes) that:
  - [ ] Uses `req.site` from middleware
  - [ ] Looks up `pages WHERE site_id = ? AND slug = ? AND status = 'published'`
  - [ ] Falls back to slug `'home'` for empty path `/`
  - [ ] Returns 404 page (which is itself a block-rendered page if seeded, otherwise hardcoded fallback) if not found
  - [ ] Server-renders the page using `<BlockRenderer>`
  - [ ] Injects per-site brand tokens as CSS custom properties in `<head>`
- [ ] Wrap the rendered page in the existing app shell (header, footer from your template) — but with site-aware branding
- [ ] Add `<meta>` tags from `pages.seo` (basic: title, description for now; full SEO in Phase 9)
- [ ] Seed `muldoon-dental` home page with a real blocks array: hero + rich-text + cta
- [ ] Seed `demo-site` home page with a different blocks array

**Tests:**
- [ ] `GET muldoon.preview.anchorcorps.dev/` returns 200 with hero text from seed
- [ ] `GET demo.preview.anchorcorps.dev/` returns 200 with different content
- [ ] `GET muldoon.preview.anchorcorps.dev/nonexistent` returns 404
- [ ] Brand tokens differ between the two sites' rendered CSS

**Demo milestone:** Two live URLs serving different content from block JSON. **Email trigger:** "🎉 First multi-tenant page is live — visit https://muldoon.preview.anchorcorps.dev and https://demo.preview.anchorcorps.dev. Same renderer, different content, all from blocks JSON."

---

## Task 1.7 — Revision tracking on save

Even though there's no editor yet, build the save endpoint and revision tracking now so Phase 5 just plugs in.

- [ ] Create `POST /api/sites/:siteId/pages/:pageId` (admin-only):
  - [ ] Validates entire blocks array against registry schemas
  - [ ] Updates `pages.blocks` and `pages.seo`
  - [ ] Inserts a `page_revisions` row in the same transaction
  - [ ] Returns the saved page + new revision ID
- [ ] Create `GET /api/sites/:siteId/pages/:pageId/revisions` returning ordered revision list
- [ ] Create `POST /api/sites/:siteId/pages/:pageId/revisions/:revisionId/restore` that re-saves an old revision as the current state (which itself creates a new revision row — never destructive)
- [ ] Add basic rate limiting on saves (10/min/user is fine)

**Tests:**
- [ ] Saving a valid blocks array creates a revision
- [ ] Saving an invalid blocks array rejects with 400 and clear error
- [ ] Restoring an old revision creates a new revision (doesn't overwrite)
- [ ] Revisions are returned in reverse chronological order

---

## Task 1.8 — Deploy to Cloud Run with wildcard subdomain

- [ ] Add `Dockerfile` (or update existing) for the renderer
- [ ] Add `cloudbuild.yaml` or update existing CI to deploy to Cloud Run on main branch push
- [ ] Configure Cloud Run service to allow unauthenticated requests on rendering routes
- [ ] Map wildcard domain `*.preview.anchorcorps.dev` to the Cloud Run service
  - [ ] If wildcard mapping is not available in your GCP region, log to `BLOCKERS.md` and fall back to manual per-subdomain mapping for the two seed sites
- [ ] Verify SSL provisions
- [ ] Confirm both seed sites resolve in production
- [ ] Document deploy process in `docs/deploy.md`

**Tests:**
- [ ] CI deploys successfully on push to main
- [ ] Production URLs serve the same content as local

**Demo milestone:** Real production URLs working. **Email trigger:** "Phase 1 sites are live in production — https://muldoon.preview.anchorcorps.dev. SSL active, multi-tenant routing working."

---

## Task 1.9 — Routine state files + email infra

- [ ] Create `.routine/STATE.json` schema and initial file (current phase, current task, last email sent timestamp, last commit hash, test pass/fail)
- [ ] Create `.routine/EMAIL-TRIGGERS.md` (see template at end of this file)
- [ ] Wire up email sending — use the existing app's email service for consistency
- [ ] Create email templates in `.routine/templates/`:
  - [ ] `phase-started.md`
  - [ ] `phase-completed.md`
  - [ ] `demo-milestone.md`
  - [ ] `blocker.md`
  - [ ] `daily-digest.md`
- [ ] Test each email type by triggering manually once
- [ ] Confirm receipt in inbox

**Tests:**
- [ ] Each email template renders without missing variables
- [ ] State file updates atomically (no partial writes)

---

## Task 1.10 — Documentation pass + handoff prep for Phase 2

- [ ] Update `README.md` with the new architecture overview (paste from PLAN.md anchors)
- [ ] Write `docs/blocks.md` explaining how to add a new block type (the routine itself will use this in Phase 2)
- [ ] Write `docs/data-model.md` finalized
- [ ] Write `docs/local-dev.md` finalized
- [ ] Write `docs/deploy.md` finalized
- [ ] Append final entry to phase log
- [ ] Update `PLAN.md` — check off Phase 1 box
- [ ] **Email trigger:** Phase 1 complete summary email with:
  - Demo URLs
  - What changed in the codebase (high-level)
  - Test coverage stats
  - What Phase 2 will do
  - Explicit ask: "Reply 'go' to start Phase 2, or reply with changes/concerns."

---

## Completion log

> Append entries as work proceeds. Each entry: timestamp, task IDs touched, what was done, what's next, any new blockers.

<!-- Routine appends here -->

### 2026-05-18 21:25 UTC — Task 1.0 (Backend scaffold)
**Commit:** d42f143
**Done:** Stood up Express + Vite middleware-mode server (`src/server/{index,app,db}.ts`), `/healthz`, Postgres pool with `ping()`, `node-pg-migrate` setup with `pgcrypto` init migration, Resend email stub, Dockerfile skeleton, docker-compose for local Postgres 16, TypeScript toolchain (server-side only). Added `D-013`, `D-014`, `D-015` to DECISIONS. Approval file `.routine/TASK-1.0-APPROVED` present.
**Tests added:** 3 (`tests/smoke/baseline.test.ts`) — 2 passing, 1 skipped (DB test gated on `DATABASE_URL`). Migration up/down test deferred — manual verification noted in the task box.
**Next:** Task 1.1 — capture this baseline into `.routine/baseline-tests.log` (already done as part of 1.0 outro) and add any missing smoke coverage. Then on to Task 1.2 (sites/pages/revisions migration).
**Notes:**
- Email infra is not yet wired (Resend stub returns `ok:false`). The "Phase 1 started" email trigger at the end of Task 1.1 will be deferred until Task 1.9 lands — until then, equivalent updates surface in this completion log.
- Vite's `/api → :3000` proxy was removed; Vite no longer runs standalone.
- Existing client (`src/App.jsx` and the rest) was not touched. `npm run dev` now runs Express on `:3000` which serves the SPA via Vite middleware — same SPA, different parent process.
- 10 npm-audit vulnerabilities reported on install (6 moderate, 4 high). Mostly transitive; raising a low-priority blocker would be premature this early. Will reassess after Task 1.2.

### 2026-05-18 22:41 UTC — Task 1.2 (Postgres schema for sites, pages, revisions)
**Commit:** *(filled below)*
**Done:** Schema migration creates four core tables (`sites`, `site_domains`, `pages`, `page_revisions`) with proper FKs/cascades, CHECK constraints on status fields, GIN index on `pages.blocks` for future structural queries, UNIQUE(site_id, slug) on pages, and a shared `touch_updated_at()` trigger function. Wrote idempotent `db/seed.ts` (UPSERT pattern) seeding `muldoon-dental` and `demo-site` with home pages. Documented schema in `docs/data-model.md`. Refactored seed into an exported `seed(pool)` function so it's callable from tests.
**Tests added:** 8 (`tests/integration/schema.test.ts` ×6, `tests/integration/seed.test.ts` ×2). Total suite now **13 passing, 0 skipped**. Tests gated on `TEST_DATABASE_URL` so they auto-skip when no DB env is provided.
**Next:** Task 1.3 — block registry pattern with `registerBlock()` runtime API (per D-016), three block types (Hero, RichText, CTA), Zod schemas.
**Notes:**
- Docker port collision: host already had Postgres on `:5432` and a stray `anchor_db` container on `:5433`. Settled on `:5434` for our `anchor-sites-postgres-1` container. `docker-compose.yml` and `.env.example` updated.
- Test isolation: created `anchor_test` database in the same container; `TEST_DATABASE_URL` points there. Schema test migrates fully down then up — destructive to that DB only. Vitest pinned to `pool: "forks"`, `singleFork: true` so the schema test finishes before the seed test runs.
- `author_id` in `page_revisions` is intentionally nullable `uuid` with no FK yet — Phase 8 (Better-auth, D-020) will add the FK to `auth_users` without a type change.
- `site_plugins` table NOT created here; deferred to Phase 7.5 per D-016. Phase 1 middleware will return `req.site.plugins = []` as a literal until then.

### 2026-05-18 21:32 UTC — Task 1.1 (Pre-flight baseline)
**Commit:** 3a9fd8c
**Done:** Verified `npm run dev` boots Express + Vite middleware cleanly. `curl :3000/healthz` → 200 `{ok:true,db:false}`, `curl :3000/` → 200 with Vite-transformed SPA index. Added `tests/smoke/spa.test.ts` covering SPA index render + route-order check (Vite middleware doesn't shadow `/healthz`). Refactored Vite-dev mount into `src/server/vite-dev.ts` so prod entry and test share one path. Updated `.routine/baseline-tests.log` with the captured baseline.
**Tests added:** 2 (`tests/smoke/spa.test.ts`). Total suite now 4 passed, 1 skipped (DB), tsc clean.
**Next:** Task 1.2 — migration for `sites`, `site_domains`, `pages`, `page_revisions`. First task that needs a live Postgres — will start docker-compose at the top of the run and verify the DB-pool test moves from skipped to passing.
**Notes:**
- The "Phase 1 started" email trigger still deferred (Task 1.9 carries it).
- Vite teardown in tests emits some esbuild stderr noise but does not affect results. Worth investigating only if it becomes a CI signal problem.

---

## Phase 1 definition of done

Every box above checked, AND:

- All baseline smoke tests still pass
- New tests written for each new feature, all green
- `muldoon.preview.anchorcorps.dev` and `demo.preview.anchorcorps.dev` both load real content from JSONB blocks in production
- Save endpoint works (verified via curl, even without UI)
- Revision history populates on save
- Existing auth/blog/events flows still functional
- All five state files exist and are populated
- Email infrastructure has fired at least three different email types successfully
- Phase 2 is greenlit by human before any Phase 2 work begins

---

## Appendix — Email triggers reference for this phase

Send email when:

| Trigger | When | Subject prefix |
|---|---|---|
| Phase started | Task 1.1 completes | `[Builder] Phase 1 started:` |
| First renderer demo | Task 1.4 completes | `[Builder] Demo ready:` |
| First multi-tenant site live | Task 1.6 completes | `[Builder] 🎉 First sites live:` |
| Production deploy live | Task 1.8 completes | `[Builder] Production live:` |
| Blocker raised | Any time | `[Builder] ⚠ Blocker:` |
| Phase 1 complete | Task 1.10 completes | `[Builder] ✓ Phase 1 complete — ready for Phase 2?` |
| Daily digest | No other email fired in 24h | `[Builder] Daily digest —` |
