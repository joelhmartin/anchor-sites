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

- [x] Create `src/blocks/` directory
- [x] Create `src/blocks/types.ts` with the base `Block` type
- [x] Create `src/blocks/registry.ts` exporting `registerBlock(type, entry)` plus `getBlock`, `listBlocks`, `hasBlock`, and `__resetRegistryForTests`. No static map — per D-016, plugins call the same `registerBlock` at manifest load time.
- [x] Add `zod-to-json-schema` dependency (Zod already present). Phase 6 helper for AI-prompt generation will live next to `registry.ts` when AI editing lands.
- [x] Create three block types in their own folders:
  - [x] `src/blocks/hero/` — schema.ts, component.tsx, styles.css, index.ts
  - [x] `src/blocks/rich-text/` — schema.ts, component.tsx, styles.css, index.ts (dangerouslySetInnerHTML now; Tiptap in Phase 5 per D-017)
  - [x] `src/blocks/cta/` — schema.ts, component.tsx, styles.css, index.ts
- [x] Each block component:
  - [x] Uses `ac-` class prefix exclusively (root + BEM-style children: `ac-hero__title` etc.)
  - [x] Uses CSS custom properties for colors (`var(--theme-main)`, `var(--theme-accent)`, etc.)
  - [x] Does not declare `font-family` in its CSS (asserted by SSR-output test)
  - [x] Is a pure function of props (no useState, no useEffect, no internal state)
- [x] Every schema uses Zod `.default(...)` so empty-object input still validates
- [x] `src/blocks/index.ts` imports each block's index (triggering self-registration) and re-exports the registry API

**Tests:**
- [x] Each block schema validates valid props and rejects invalid (e.g. empty `title`, unknown `align`/`max_width`/`variant`)
- [x] Registry lookup by type returns the expected entry; duplicates throw; unknown types return undefined
- [x] All three components render via `renderToString` without crashing
- [x] Bonus: SSR-output never contains `font-family:` (architectural anchor #8 enforced by test)

---

## Task 1.4 — BlockRenderer component

- [x] Create `src/components/BlockRenderer.tsx`:
  ```tsx
  type Props = { blocks: Block[]; editable?: boolean };
  ```
- [x] For each block:
  - [x] Look up registry entry, render `<UnknownBlock>` placeholder if type not found
  - [x] Validate `props` with the registry schema (Zod `safeParse`)
  - [x] On validation failure, render `<BlockError>` showing the error in dev, silent placeholder in prod (gated on `NODE_ENV`)
  - [x] On success, render the component with parsed props
  - [x] Pass `block.id` as React key
- [x] Create `<UnknownBlock>` and `<BlockError>` fallback components
- [x] Add `data-block-id` and `data-block-type` attributes on each rendered block's root element via a thin `<Wrap>` (only emitted when `editable={true}`; production renders a Fragment with no markup noise)
- [x] Create a Storybook-style harness route at `/__blocks/preview` that lets you POST a blocks array and see it render — gated to non-production env in `app.ts`

**Tests:**
- [x] Renderer handles empty array
- [x] Renderer handles unknown block type without crashing (`<UnknownBlock>`)
- [x] Renderer handles invalid props without crashing (`<BlockError>`)
- [x] Renderer renders three known blocks in order with correct keys
- [x] BlockError is silent (aria-hidden placeholder) when `NODE_ENV=production`
- [x] Non-editable mode omits `data-block-*` wrapper
- [x] HTTP smoke tests for GET + POST `/__blocks/preview` + 400 on malformed input

**Demo milestone:** `/__blocks/preview` is live in dev. POST `{"blocks":[…]}` and the harness renders SSR HTML with `ac-` classes and `data-block-id`/`data-block-type` editor hooks. **Email trigger:** Deferred — Resend not wired until Task 1.9; logged in completion log instead.

---

## Task 1.5 — Multi-tenant request resolution

- [x] Create middleware `src/middleware/resolveSite.ts`:
  - [x] Read `Host` header
  - [x] Strip port if present
  - [x] Look up `site_domains` for matching hostname → `site_id`
  - [x] Fallback: parse subdomain from `*.preview.anchorcorps.dev` or `*.anchorcorps.dev` → match `sites.slug`
  - [x] Attach `req.site` to the request — type includes `plugins: PluginInstance[]` (empty array in Phase 1; field reserved per D-016 so Phase 7.5 doesn't have to retrofit)
  - [x] Return 404 site-not-found page if no match
- [x] Cache the host→site lookup in-memory with a 60s TTL (per-process Map is fine for now; Redis later)
- [x] Mount middleware on all routes *except* the existing admin/auth/blog routes (those stay tenant-less for now — they'll be tenant-aware in Phase 8) — *Phase 1 wires it onto the dev-only `/__site` probe; Task 1.6 mounts it on the catch-all page route*
- [x] Update local dev: add `/etc/hosts` instructions to `docs/local-dev.md` for `muldoon.localhost` and `demo.localhost`

**Tests:**
- [x] Request with `Host: muldoon.preview.anchorcorps.dev` resolves to muldoon site
- [x] Request with `Host: demo.preview.anchorcorps.dev` resolves to demo site
- [x] Request with unknown host returns 404
- [x] Existing auth route still works (not tenant-scoped yet) *(verified via `/healthz` mounted before the middleware in `buildApp` integration harness; `tests/smoke/baseline.test.ts` still green)*
- [x] Bonus: port stripping, subdomain fallback to `sites.slug`, positive cache hit, negative cache hit

---

## Task 1.6 — Page rendering route

- [x] Create route `GET /:slug*` (catch-all, registered *after* all existing routes) that:
  - [x] Uses `req.site` from middleware
  - [x] Looks up `pages WHERE site_id = ? AND slug = ? AND status = 'published'`
  - [x] Falls back to slug `'home'` for empty path `/`
  - [x] Returns 404 page (which is itself a block-rendered page if seeded, otherwise hardcoded fallback) if not found *(404 wears the site shell + brand tokens)*
  - [x] Server-renders the page using `<BlockRenderer>`
  - [x] Injects per-site brand tokens as CSS custom properties in `<head>`
- [x] Wrap the rendered page in the existing app shell (header, footer from your template) — but with site-aware branding *(Phase 1 ships a minimal SSR shell. The existing `src/components/marketing/{Navbar,Footer}.jsx` are JSX and require the full Vite SSR pipeline per D-014; Phase 5 will fold them in when Puck + SSR plumbing land.)*
- [x] Add `<meta>` tags from `pages.seo` (basic: title, description for now; full SEO in Phase 9)
- [x] Seed `muldoon-dental` home page with a real blocks array: hero + rich-text + cta
- [x] Seed `demo-site` home page with a different blocks array

**Tests:**
- [x] `GET muldoon.preview.anchorcorps.dev/` returns 200 with hero text from seed
- [x] `GET demo.preview.anchorcorps.dev/` returns 200 with different content
- [x] `GET muldoon.preview.anchorcorps.dev/nonexistent` returns 404
- [x] Brand tokens differ between the two sites' rendered CSS
- [x] Bonus: unknown host passes through to downstream (Vite/SPA fallback); draft pages are not served

**Demo milestone:** Two live URLs serving different content from block JSON. **Email trigger:** Deferred — Resend not wired until Task 1.9; surfaced in chat instead. Demo milestone id: `first-multi-tenant-page-local`.

---

## Task 1.7 — Revision tracking on save

Even though there's no editor yet, build the save endpoint and revision tracking now so Phase 5 just plugs in.

- [x] Create `POST /api/sites/:siteId/pages/:pageId` (admin-only):
  - [x] Validates entire blocks array against registry schemas
  - [x] Updates `pages.blocks` and `pages.seo`
  - [x] Inserts a `page_revisions` row in the same transaction
  - [x] Returns the saved page + new revision ID
- [x] Create `GET /api/sites/:siteId/pages/:pageId/revisions` returning ordered revision list
- [x] Create `POST /api/sites/:siteId/pages/:pageId/revisions/:revisionId/restore` that re-saves an old revision as the current state (which itself creates a new revision row — never destructive)
- [x] Add basic rate limiting on saves (10/min/user is fine) *(per-IP token-bucket via `src/middleware/rateLimit.ts`; default 10/min, configurable for tests)*

**Tests:**
- [x] Saving a valid blocks array creates a revision
- [x] Saving an invalid blocks array rejects with 400 and clear error
- [x] Restoring an old revision creates a new revision (doesn't overwrite)
- [x] Revisions are returned in reverse chronological order
- [x] Bonus: 401 without admin token; 401 with wrong token; 400 on unknown block type; 404 on cross-site page id; 404 on cross-page revision id; 429 after exhausting the bucket (Retry-After present)

---

## Task 1.8 — Deploy to Cloud Run with wildcard subdomain

> **Status:** repo-side artifacts landed; production execution is on hold pending B-001 (needs human GCP credentials). Tasks 1.9 + 1.10 proceed in parallel; this section reopens when `.routine/TASK-1.8-APPROVED` lands.

- [x] Add `Dockerfile` (or update existing) for the renderer *(multi-stage, prod-only npm ci in the run stage, `PORT=8080` for Cloud Run; `tsx` moved to `dependencies`)*
- [x] Add `cloudbuild.yaml` or update existing CI to deploy to Cloud Run on main branch push *(authored; trigger creation is in `docs/deploy.md` step 6)*
- [ ] Configure Cloud Run service to allow unauthenticated requests on rendering routes *(set via `--allow-unauthenticated` in `cloudbuild.yaml`; runs when the human executes `docs/deploy.md` step 7)*
- [ ] Map wildcard domain `*.preview.anchorcorps.dev` to the Cloud Run service
  - [ ] If wildcard mapping is not available in your GCP region, log to `BLOCKERS.md` and fall back to manual per-subdomain mapping for the two seed sites *(fallback documented in `docs/deploy.md` step 9; will fire if the wildcard mapping is rejected)*
- [ ] Verify SSL provisions
- [ ] Confirm both seed sites resolve in production
- [x] Document deploy process in `docs/deploy.md` *(full step-by-step from API enablement through wildcard domain mapping + rollback)*
- [x] Remove `vercel.json` (D-010) *(no longer present)*

**Tests:**
- [ ] CI deploys successfully on push to main
- [ ] Production URLs serve the same content as local

**Demo milestone:** Real production URLs working. **Email trigger:** Deferred — Resend wires in Task 1.9. Surfaces in chat when production URLs are confirmed.

**Blocker:** B-001 — Phase 1 production deploy needs human GCP access. See `BLOCKERS.md`.

---

## Task 1.9 — Routine state files + email infra

- [x] Create `.routine/STATE.json` schema and initial file (current phase, current task, last email sent timestamp, last commit hash, test pass/fail) *(already populated; typed schema lives in `src/server/routine-state.ts`)*
- [x] Create `.routine/EMAIL-TRIGGERS.md` (see template at end of this file) *(already present from earlier setup)*
- [x] Wire up email sending — use the existing app's email service for consistency *(`src/server/email/send.ts` — Resend HTTP API, three modes: stub / dry-run / api, driven by `RESEND_API_KEY`)*
- [x] Create email templates in `.routine/templates/`:
  - [x] `phase-started.md`
  - [x] `phase-completed.md`
  - [x] `demo-milestone.md`
  - [x] `blocker.md`
  - [x] `daily-digest.md`
- [ ] Test each email type by triggering manually once *(deferred — requires a real `RESEND_API_KEY` and `RESEND_FROM` domain. Routine surfaces email-worthy events in chat per the user's standing instruction; first real send happens once the operator drops a key into Secret Manager during Task 1.8 deploy.)*
- [ ] Confirm receipt in inbox *(deferred — same gate as above; the dry-run mode test verifies the wire format without a real send)*

**Tests:**
- [x] Each email template renders without missing variables *(`src/server/email/send.test.ts` covers all 5 templates with `it.each`, plus an "unknown vars stay literal" guardrail)*
- [x] State file updates atomically (no partial writes) *(`src/server/routine-state.test.ts` — atomic-rename roundtrip + 3-way concurrent updateState leaves valid JSON)*

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
**Commit:** fc6f593
**Done:** Schema migration creates four core tables (`sites`, `site_domains`, `pages`, `page_revisions`) with proper FKs/cascades, CHECK constraints on status fields, GIN index on `pages.blocks` for future structural queries, UNIQUE(site_id, slug) on pages, and a shared `touch_updated_at()` trigger function. Wrote idempotent `db/seed.ts` (UPSERT pattern) seeding `muldoon-dental` and `demo-site` with home pages. Documented schema in `docs/data-model.md`. Refactored seed into an exported `seed(pool)` function so it's callable from tests.
**Tests added:** 8 (`tests/integration/schema.test.ts` ×6, `tests/integration/seed.test.ts` ×2). Total suite now **13 passing, 0 skipped**. Tests gated on `TEST_DATABASE_URL` so they auto-skip when no DB env is provided.
**Next:** Task 1.3 — block registry pattern with `registerBlock()` runtime API (per D-016), three block types (Hero, RichText, CTA), Zod schemas.
**Notes:**
- Docker port collision: host already had Postgres on `:5432` and a stray `anchor_db` container on `:5433`. Settled on `:5434` for our `anchor-sites-postgres-1` container. `docker-compose.yml` and `.env.example` updated.
- Test isolation: created `anchor_test` database in the same container; `TEST_DATABASE_URL` points there. Schema test migrates fully down then up — destructive to that DB only. Vitest pinned to `pool: "forks"`, `singleFork: true` so the schema test finishes before the seed test runs.
- `author_id` in `page_revisions` is intentionally nullable `uuid` with no FK yet — Phase 8 (Better-auth, D-020) will add the FK to `auth_users` without a type change.
- `site_plugins` table NOT created here; deferred to Phase 7.5 per D-016. Phase 1 middleware will return `req.site.plugins = []` as a literal until then.

### 2026-05-18 22:49 UTC — Task 1.3 (Block registry + 3 block types)
**Commit:** b9b18df
**Done:** Built the keystone of the builder. `src/blocks/types.ts` defines the canonical `Block` and `BlockRegistryEntry` types. `src/blocks/registry.ts` exports `registerBlock`/`getBlock`/`listBlocks`/`hasBlock` over a private `Map` — same API plugins will use in Phase 7.5 (D-016). Implemented three block types (`hero`, `rich-text`, `cta`), each with its own folder containing `schema.ts` (Zod with `.default()` on every field), `component.tsx` (pure function of props, `ac-` BEM classes, no font-family), `styles.css` (CSS custom properties for colors), and `index.ts` (registers via side-effect import). `src/blocks/index.ts` is the package entry — importing it registers all three.
**Tests added:** 17 (registry behavior ×4, schema validation ×8 across the three blocks, SSR render assertions ×4, side-effect-registration check ×1). Total suite now **30 passing, 0 skipped**, tsc clean.
**Next:** Task 1.4 — `BlockRenderer` component that validates each block's props with the registry schema and falls back to `<UnknownBlock>` / `<BlockError>` gracefully. Includes the `/__blocks/preview` admin-only harness.
**Notes:**
- Added deps: `nanoid` (for future ID generation in editor), `zod-to-json-schema` (for Phase 6 AI prompts), `@types/react@18` + `@types/react-dom@18` (pinned to match React 18 in deps).
- Vitest config now includes `.test.tsx` files and sets `css: false` so block CSS imports are no-ops in tests.
- CSS lives in plain `.css` files (not CSS Modules) so the `ac-` prefix survives unhashed — that's the public API consumers can target per architectural anchor #8.

### 2026-05-18 22:53 UTC — Task 1.4 (BlockRenderer + /__blocks/preview harness)
**Commit:** 32bbdca
**Done:** Built `<BlockRenderer>` that walks an array of blocks, looks each one up in the registry, validates props with the block's Zod schema, and renders one of: the real component (happy path), `<UnknownBlock>` (type missing), or `<BlockError>` (props invalid). Fallbacks render silent `aria-hidden` placeholders in production, visible debug UI in dev. Editable mode wraps each rendered block in a `<div data-block-id data-block-type>` for the Phase 5 editor to resolve clicks; non-editable mode emits no wrapper. Added the `/__blocks/preview` admin-only harness — an Express GET serves a small HTML form, POST accepts `{blocks:[…]}` JSON and returns SSR HTML. Mounted dev-only via `NODE_ENV !== "production"` gate in `app.ts`.
**Tests added:** 9 (`src/components/BlockRenderer.test.tsx` ×6, `tests/smoke/blocks-preview.test.ts` ×3). Total suite now **39 passing, 0 skipped**, tsc clean. Verified end-to-end with curl against the live dev server.
**Next:** Task 1.5 — multi-tenant request resolution middleware (Host header → site_id, with subdomain fallback).
**Notes:**
- **Server can't import block CSS.** tsx (Node ESM runtime) chokes on `.css` imports. Refactored each block's `index.ts` to be server-safe (no CSS imports), and added `src/blocks/styles.ts` as a client-only entry that imports all CSS. The SPA client bundle will pick this up; SSR doesn't need the CSS bytes (it emits class names only).
- **React SSR gotcha:** rendering `<strong>Block error: {type}</strong>` produced `Block error: <!-- -->{type}` because React SSR inserts comment markers between adjacent text and expression children. Fixed by combining into a single template-literal expression.
- **Wrap component** is a tiny indirection — in `editable` mode it emits `<div data-block-id data-block-type>`, otherwise a Fragment. Keeps production HTML free of editor noise while giving Puck a stable selector path in Phase 5.

### 2026-05-18 23:37 UTC — Task 1.9 (Resend wiring + atomic STATE.json helper)
**Commit:** a78e350 (preceded by 8e4dac7)
**Done:** Email infrastructure end-to-end ready for the first real send. `src/server/email/send.ts` replaces the Task 1.0 stub with a Resend HTTP API client that runs in three modes — `stub` (no `RESEND_API_KEY` → console log + ok:false), `dry-run` (`RESEND_API_KEY="dry-run"` → renders + returns ok:true without HTTP), and `api` (any other value → POST to https://api.resend.com/emails with Bearer auth). `renderTemplate(name, vars)` reads `.routine/templates/<name>.md`, fills `{{key}}` placeholders, splits the `Subject:` header from the body, and intentionally leaves unknown vars as literal placeholders so missing data shows up loudly. Added a typed `RoutineState` shape and an atomic `writeStateAtomic`/`updateState` helper (tempfile + POSIX rename) so any future in-process state writer can't leave the file half-written. `.dockerignore` updated to keep `.routine/templates/` in the production image.
**Tests added:** 16 (12 in `src/server/email/send.test.ts` + 4 in `src/server/routine-state.test.ts`). All 5 templates render with substitution, missing-var safety, stub/dry-run/api modes including Bearer auth header + JSON body shape, non-2xx mapping, state-file atomic roundtrip, formatted output (trailing newline + 2-space indent), mutator persistence, 3-way concurrent updateState. Total suite now **80 passing, 0 skipped**, tsc clean.
**Next:** Task 1.10 — README architecture overview, `docs/blocks.md`, finalize `docs/data-model.md` + `docs/local-dev.md` + `docs/deploy.md`, surface Phase 1 completion in chat (Resend stays in stub mode until Task 1.8 ships secrets to prod, so the "ready for Phase 2" message is chat-only).
**Notes:**
- "Test each email type by triggering manually once" + "Confirm receipt in inbox" stay unchecked. They require a real `RESEND_API_KEY` and a verified `RESEND_FROM` domain — both belong with the human operator during Task 1.8's Secret Manager step. The dry-run mode + the api-mode unit test verify the wire format without a real send.
- The templates already shipped in `.routine/templates/` from earlier setup. Task 1.9 added the engine, not the prose.
- `RESEND_FROM` defaults to `AnchorCorps Builder <builder@anchorcorps.dev>`. The operator will override with whatever domain they verify in Resend.
- Atomic state helper is opt-in — the routine still updates STATE.json via the Write tool, which is also atomic at the filesystem level. The helper exists for any in-process code path that needs to record into `emails_sent` or similar (e.g., a future scheduler).

### 2026-05-18 23:30 UTC — Task 1.8 (Cloud Run artifacts; deploy blocked on B-001)
**Commit:** 53bc8a5
**Done:** All repo-side artifacts for the Cloud Run deploy. `Dockerfile` rewritten — multi-stage, runtime stage uses `npm ci --omit=dev`, `PORT=8080` (Cloud Run default), `tsx` moved from `devDependencies` to `dependencies` so `npm start` resolves inside the prod image. `cloudbuild.yaml` defines build → push → migrate job → `gcloud run deploy` with `--allow-unauthenticated`, Cloud SQL socket attachment, and `--set-secrets` for `DATABASE_URL` / `ADMIN_API_TOKEN` / `RESEND_API_KEY`. `vercel.json` deleted (D-010). `docs/deploy.md` walks the human operator from API enablement through Cloud SQL provisioning, Secret Manager, the migration + seed Cloud Run Jobs, the Cloud Build trigger, and wildcard domain mapping (with per-subdomain fallback documented).
**Tests added:** 0 — no new code paths to test on the routine side. The "CI deploys on push to main" + "Production URLs serve same content as local" tests are post-deploy checks that fire after B-001 resolves.
**Next:** Raise B-001 (done), then proceed to Task 1.9 (Resend wiring + email templates) and Task 1.10 (docs pass) — neither needs production access. Task 1.8 reopens once `.routine/TASK-1.8-APPROVED` lands.
**Notes:**
- `tsx` is now a runtime dep because the server entry is `tsx src/server/index.ts` (no compile step). Phase 12 may swap to a precompiled JS bundle to drop the dep.
- Build pipeline pre-deploys a migration via a Cloud Run **Job** (`anchor-sites-migrate`) so a schema change can't ship to the service before the DB is ready for it. Same approach for the one-off seed (`anchor-sites-seed`).
- `cloudbuild.yaml` substitutions include `_SQL_INSTANCE` with a placeholder; the human sets the real value via the Cloud Build trigger or `--substitutions=` on the first manual `gcloud builds submit`.
- Wildcard domain mapping (`gcloud beta run domain-mappings create --domain='*.preview.anchorcorps.dev'`) is documented; the doc explicitly handles the "not supported in region" case by falling back to per-subdomain mappings for the two seed hostnames.

### 2026-05-18 23:25 UTC — Task 1.7 (admin save + revisions + restore)
**Commit:** 8f273e3 (preceded by 2b0c74a, 6d970ec)
**Done:** Admin API for saving page content with append-only revision history. `POST /api/sites/:siteId/pages/:pageId` validates the payload (Zod) AND each block's props against its registry schema before updating `pages.blocks`/`pages.seo` and inserting a `page_revisions` row in the same transaction — atomicity guarantees nothing's saved without a corresponding history entry. `GET /api/sites/:siteId/pages/:pageId/revisions` returns reverse-chronological list. `POST .../revisions/:revisionId/restore` copies the revision back into `pages` AND inserts a new `restore:<id>`-tagged revision — history never gets overwritten. Two new middlewares: `requireAdmin` (X-Admin-Token vs `ADMIN_API_TOKEN` env, refuses if env unset) and `rateLimit` (token-bucket per-key, default key = `req.ip`, 10/min budget on save + restore).
**Tests added:** 10 (`tests/integration/admin-pages.test.ts`) — auth (401 missing/wrong token), valid save (revision + page state), invalid props (400 with structured `failures[]`), unknown type, cross-site page id (404), list ordering, restore non-destructive (3 revisions after restore of the 1st), cross-page revision id (404), rate limit (429 + Retry-After). Total suite now **64 passing, 0 skipped**, tsc clean.
**Next:** Task 1.8 — Dockerfile, `cloudbuild.yaml`, Cloud Run deploy, wildcard domain mapping, SSL, remove `vercel.json`. Likely needs human GCP credentials → if so, raise a blocker and continue with Tasks 1.9 + 1.10 first.
**Notes:**
- `requireAdmin` is applied per-route, not router-level, so unknown `/api/*` paths return 404 (preserving the baseline smoke test that hits `/api/does-not-exist`). Caught immediately on first full-suite run after wiring the router.
- `ADMIN_API_TOKEN` is **not** set by default — `requireAdmin` returns 401 if the env var is absent. No silent admin access. Phase 8 (Better-auth per D-020) replaces with session-based admin checks; until then the editor will hold this token in its env config.
- Rate limit key is `req.ip` for now. When real auth lands in Phase 8, swap to a user-id-keyed bucket. Bucket is per-process; revisit in Phase 12 hardening for multi-instance fairness.
- Restore source tag (`restore:<revisionId>`) lets the editor surface "Restored from rev X" in the history sidebar.

### 2026-05-18 23:20 UTC — Task 1.6 (catch-all page renderer + seeded content)
**Commit:** 1737b62 (preceded by 7689098, cfd2b98, 8fccf5f)
**Done:** First-class multi-tenant rendering. Catch-all `GET /*` router (`src/server/routes/page.ts`) uses `resolveSite({ passThroughOnMiss: true })` so known hosts render and unknown hosts (e.g. `127.0.0.1` in dev) fall through to the Vite/SPA layer mounted in `src/server/index.ts`. SSR helper (`src/server/render-page.tsx`) wraps `<BlockRenderer>` in an `ac-site-header` / `ac-site-main` / `ac-site-footer` shell, injects per-site `default_brand_tokens` as `:root` CSS custom properties, sets `<title>` + optional `<meta name="description">` from `pages.seo`, and provides a 404 page rendered in the same site shell. Both seeded sites now have published home pages with hero + rich-text + cta blocks (muldoon: dental copy + #0a3d62 brand; demo: builder pitch + #1f1f1f brand). Added `passThroughOnMiss` option to `resolveSite` so the catch-all coexists with the SPA dev experience on `localhost:3000`.
**Tests added:** 7 (6 page-render + 1 resolveSite passthrough). `tests/integration/page-render.test.ts` covers muldoon home, demo home, 404 in shell, unknown-host passthrough, brand-token diff, and draft-not-served. Plus a `passThroughOnMiss` test in `resolveSite.test.ts`. Total suite now **54 passing, 0 skipped**, tsc clean.
**Next:** Task 1.7 — `POST /api/sites/:siteId/pages/:pageId` save endpoint with `page_revisions` insert in the same transaction, GET revisions list, and revision restore (non-destructive — creates a new revision row).
**Notes:**
- **Caught a real bug via the integration test.** First seed pass used `max_width: "md"/"lg"` and `cta.title`/`variant: "secondary"` — the Zod schemas reject all three. The page-render test surfaced the validation failure (`<BlockError>` markup leaking into the HTML). Fixed seed to match the schemas — proof that Task 1.3's "schema is the contract" anchor works.
- Existing JSX app shell (`src/components/marketing/Navbar.jsx`, `Footer.jsx`) is **not** SSR-imported. Doing so would require the full Vite `ssrLoadModule` pipeline described in D-014; that's Phase 5's job alongside Puck. Phase 1 ships a minimal but real shell so the demo milestone is testable end-to-end now.
- Catch-all is registered LAST in `createApp` so `/healthz`, `/__blocks/preview`, and `/__site` keep matching first. Vite middleware mounts AFTER `createApp` in `src/server/index.ts`, so unknown-host requests reach Vite after the catch-all calls `next()`.

### 2026-05-18 23:10 UTC — Task 1.5 (resolveSite middleware + cache)
**Commit:** 575f04b
**Done:** Built `src/middleware/resolveSite.ts` — Express middleware factory that reads `Host`, strips port + lowercases, looks up `site_domains` first, then falls back to subdomain parse against `sites.slug` for `*.preview.anchorcorps.dev` and `*.anchorcorps.dev`. Attaches `req.site` with `{id, slug, display_name, default_brand_tokens, matched_via, plugins: []}`. The `plugins` field is reserved per D-016 — empty array until Phase 7.5 fills it from `site_plugins`. Per-process 60s TTL `Map` cache memoizes both positive and negative lookups. Express `Request` augmented via `declare module "express-serve-static-core"`. Updated `db/seed.ts` to seed `site_domains` rows for both seeded sites (`muldoon.preview.anchorcorps.dev`, `muldoon.localhost`, `demo.preview.anchorcorps.dev`, `demo.localhost`). Wired a dev-only `GET /__site` probe in `app.ts` so the middleware is exercisable end-to-end before Task 1.6's catch-all lands. Wrote `docs/local-dev.md` covering setup, the four seeded hostnames, `/etc/hosts` notes, and reset commands.
**Tests added:** 8 (`tests/integration/resolveSite.test.ts`) — domain match for muldoon + demo, 404 on unknown host, `/healthz` mounted before middleware still works, port stripping, subdomain → `sites.slug` fallback (with an ad-hoc inserted site), positive cache hit (spy pool, query count stays 1), negative cache hit. Total suite now **47 passing, 0 skipped**, `tsc --noEmit` clean.
**Next:** Task 1.6 — catch-all `GET /:slug*` page rendering route that consumes `req.site`, looks up `pages WHERE site_id = ? AND slug = ?`, injects brand tokens into `<head>`, and SSR-renders blocks via `<BlockRenderer>`.
**Notes:**
- Mounting decision: did NOT register `resolveSite()` globally on `createApp`. `/healthz`, the SPA index served by Vite middleware, and `/__blocks/preview` must stay tenant-less. Task 1.6 will mount it on its catch-all router. For Phase 1 the middleware is wired only on `/__site` (dev-only) — enough to prove the lookup pipeline end-to-end without breaking the existing dev workflow.
- Subdomain fallback regex deliberately excludes `*.localhost` — localhost dev relies on the explicit `site_domains` seed rows. Keeps the regex narrow and prod-shaped.
- The cache is per-process and currently has no invalidation. Phase 10 (domain provisioning) is the natural place to add invalidation broadcasts; until then, 60s TTL is the recovery window.
- Vite's esbuild "request is outdated" noise on test teardown is unchanged from prior runs (noted in 1.1 log). No suite signal impact.

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
