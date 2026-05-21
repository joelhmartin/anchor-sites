# Phase 7 — Template system (save-as-template, new-from-template)

> Expanded + confirmed with the operator 2026-05-21 (verbal sign-off in chat
> after the EXPAND+CONFIRM gate). Builds on Phases 1–6 (block JSON canonical
> per D-001; shared block validator `src/blocks/validate.ts` per D-039; pg-boss
> per D-019; admin API + new-site wizard from Phase 4). **Not** the auth/blog/
> events copy-in (Phase 8, D-008) and **not** the plugin framework (Phase 7.5,
> D-016) — those stay separate.

## What a template is

A reusable snapshot of **pages (block JSON) + brand tokens + which pages**. You
can save an existing site (or a single page) as a template, then create a new
site (or add a page) from one. The new-site flow composes with — does not
replace — the Phase-4 wizard and the Phase-1 provisioning orchestrator.

## Confirmed design decisions (operator, 2026-05-21)

1. **Storage shape — normalized.** Two tables `templates` + `template_pages`
   mirroring `sites`/`pages` (GIN-queryable blocks, per-page operations,
   consistent with the existing schema). → **D-041**.
2. **Media on materialize — share immutable URLs (v1).** Captured blocks keep
   the source `asset_id`s; referenced images render from the existing
   immutable, content-hashed, public GCS variant URLs (D-031). No GCS copy, no
   re-processing. Trade-off recorded: the new site's media library doesn't
   "own" those assets and a source-site delete cascades its `media_assets`.
   Full per-site media copy is a documented Phase-12 follow-up. → **D-043**.
3. **Materialization — pg-boss async (per D-019).** The from-template endpoint
   enqueues a job and returns a handle; the UI polls. Idempotent + retryable.
   → **D-042**.
4. **Page-level templates — included now** (thin slice, task 7.9).

## Tasks

- [x] **7.1 — Templates data model + migration.**
  New tables:
  - `templates` (`id` uuid PK, `slug` text UNIQUE, `name` text, `description`
    text nullable, `source_site_id` uuid FK → `sites.id` ON DELETE SET NULL,
    `kind` text CHECK `'site' | 'page'` default `'site'`, `brand_tokens` jsonb
    default `'{}'`, `status` text CHECK `'active' | 'archived'` default
    `'active'`, `created_at`, `updated_at` + reuse `touch_updated_at` trigger).
  - `template_pages` (`id` uuid PK, `template_id` uuid FK → `templates.id` ON
    DELETE CASCADE, `slug` text, `title` text, `blocks` jsonb default `'[]'`,
    `seo` jsonb default `'{}'`, `sort_order` int default 0; UNIQUE(`template_id`,
    `slug`); GIN on `blocks`; INDEX(`template_id`, `sort_order`)).
  Forward + rollback migration `db/migrations/1747574000000_templates.cjs`.
  Update `docs/data-model.md` (move templates from "reserved" to real). Record
  **D-041**.

- [x] **7.2 — Template Zod schema + repository.**
  `src/server/templates/schema.ts` (`templateSchema`, `templatePageSchema`,
  `templateKindSchema`) — page blocks validated through the **same** shared
  validator (`src/blocks/validate.ts`, D-039) so a template can never hold
  blocks the save path would reject. `src/server/templates/repo.ts` (pool-
  injected): `createTemplate`, `listTemplates({ kind? })`, `getTemplate(id)`
  (+ ordered pages), `archiveTemplate(id)`. Unit + integration tests.

- [x] **7.3 — Save-a-site-as-template endpoint.**
  `POST /api/sites/:siteId/save-as-template`
  `{ name, description?, page_ids? (default: all pages), include_brand_tokens?
  (default true) }`. Snapshots each selected page's slug/title/blocks/seo +
  (optionally) the site's `default_brand_tokens` into a new `kind:'site'`
  template. Re-validates every captured page through the shared validator
  before insert (422 on any invalid). `requireAdmin`, transactional. supertest.

- [x] **7.4 — Templates admin API.**
  `GET /api/templates` (list, `?kind=` filter, newest first),
  `GET /api/templates/:id` (+ ordered pages),
  `DELETE /api/templates/:id` (archive — set `status='archived'`, never hard-
  delete). All `requireAdmin` (per-route). supertest.

- [x] **7.5 — Materialization job (pg-boss, D-019).**
  `src/server/jobs/materialize-template.ts`: payload `{ siteId, templateId }`.
  Idempotently inserts `template_pages` → `pages`
  (`ON CONFLICT (site_id, slug) DO NOTHING`), each with an initial
  `page_revisions` row `source:'import'`; merges template `brand_tokens` into
  the site's `default_brand_tokens` (only when the site has none, unless a
  flag overrides) and evicts the resolveSite cache for the site's hostnames.
  Media: blocks copied verbatim — `asset_id`s point at the source's immutable
  public variant URLs (D-043), no copy. Idempotency / singleton key
  `${siteId}:${templateId}`. Registered in `src/server/jobs/index.ts`. Tested
  via the jobs harness (`bootJobs(pool, { extraHandlers })` + reset). Record
  **D-042** + **D-043**.

- [ ] **7.6 — Create-site-from-template endpoint.**
  Extract the site-creation logic now inline in `POST /api/sites` into a shared
  helper (`createSiteWithDomains(client, {...})`) and reuse it.
  `POST /api/sites/from-template` `{ slug, display_name, template_id,
  brand_tokens? }`: creates the site + canonical domains, enqueues the
  materialization job, returns `{ site, job }`. Provisioning (`/provision`)
  stays a separate explicit step. Add a lightweight materialization-status read
  the UI can poll (job state and/or `pages_count`). supertest with pg-boss
  stubbed.

- [ ] **7.7 — Seed a starter template.**
  Idempotent `npm run db:seed-templates` (or extend `db/seed.ts`) that captures
  at least one `kind:'site'` "Starter" template so the picker isn't empty on
  day one. UPSERT by template slug. Test.

- [ ] **7.8 — Studio UI: new-site-from-template + save-as-template.**
  Extend `src/admin/pages/NewSiteWizard.tsx` with a "Blank vs Template" choice
  + template picker (`GET /api/templates?kind=site`); on submit hit
  `/api/sites/from-template` and show materialization progress (poll). Add a
  "Save as template" action on `src/admin/pages/SiteDetailPage.tsx` (modal:
  name, description, page selection). jsdom tests with `apiFetch`/fetch mocked
  + Puck stubbed (D-036). **Visual QA is operator-run at studio.localhost:3000
  — do not claim visual success.**

- [ ] **7.9 — Page-level templates (thin slice).**
  Save a single page as a `kind:'page'` template: `POST /api/sites/:siteId/
  pages/:pageId/save-as-template` `{ name, description? }` (one `template_pages`
  row, no brand tokens). "Add page from template": `POST /api/sites/:siteId/
  pages/from-template` `{ template_id, slug, title? }` — inserts the template's
  single page into an existing site (synchronous; one page, no job needed) with
  an `import` revision and `ON CONFLICT (site_id, slug)` 409. Small UI hook on
  SiteDetailPage's Pages tab ("Add from template"). supertest + jsdom.

- [ ] **7.10 — Closeout.**
  `docs/templates.md` (the whole flow: save-as-template, from-template,
  materialization, media caveat, page templates). Tick PLAN.md Phase 7. Confirm
  all D-04x recorded. Refresh `.routine/baseline-tests.log` + STATE. Mirrors the
  Phase-6 6.8 close. **PHASE 7 COMPLETE** marker; STOP at the 7→7.5 boundary.

## Completion log

<!-- Append one timestamped entry per sub-checkbox, newest at the bottom. -->

### 2026-05-21 15:30 UTC — Task 7.1
**Commit:** a32a1f6
**Done:** `templates` + `template_pages` tables (D-041) via migration `1747574000000_templates.cjs` (forward + rollback). `templates`: slug UNIQUE, kind CHECK('site'|'page'), status CHECK, brand_tokens jsonb, source_site_id FK ON DELETE SET NULL, updated_at trigger reusing `touch_updated_at`. `template_pages`: UNIQUE(template_id,slug), GIN(blocks), (template_id,sort_order) index, CASCADE from templates. Migration applies clean on dev; down/up round-trips clean. `docs/data-model.md` updated (templates moved from reserved → real).
**Tests added:** 3 (in `tests/integration/schema.test.ts`) — templates/template_pages exist + unique slug + kind CHECK + GIN; template_pages CASCADE + source_site_id SET NULL; templates updated_at trigger. Updated the down/up round-trip test to expect 7 tables.
**Next:** 7.2 (template Zod schema + repository)
**Notes:** Full cold suite 397/58 green (was 394/58). Typecheck clean. `touch_updated_at` left intact on rollback (owned by the sites/pages migration). Not yet pushed — holding the phase's first prod-deploying push for an operator checkpoint (CI=deploy, D-035).

### 2026-05-21 15:36 UTC — Task 7.2
**Commit:** a93f841
**Done:** Template schema + repository. `src/server/templates/schema.ts`: `templateKindSchema` ('site'|'page'), `templateStatusSchema`, `templatePageInputSchema`, `createTemplateInputSchema` (slug/name/description/kind/source_site_id/brand_tokens/pages), and `validateTemplatePages` — runs the shared registry validator (`validateBlocks`, D-039) across captured pages so a template can't hold blocks the save path rejects. `CreateTemplateInput` is `z.input` (callers may omit defaulted fields). `src/server/templates/repo.ts` (pool-injected): `createTemplate` (Zod + block validation, then a single transaction; sort_order from array position; `TemplateValidationError` / `TemplateSlugConflictError`), `listTemplates({kind?,status?})` with pages_count, `getTemplate(id)` (+ ordered pages), `archiveTemplate(id)` (soft delete, idempotent).
**Tests added:** 12 — `tests/integration/templates-repo.test.ts` (8: create+ordered pages+brand token, getTemplate ordering, null on unknown id, list filter+counts, archive+hide+idempotent, archive null, dup-slug conflict, block-validation rejection persists nothing) + `src/server/templates/schema.test.ts` (4, DB-free: validateTemplatePages valid/invalid, input defaults + bad-slug reject, kind enum).
**Next:** 7.3 (save-a-site-as-template endpoint)
**Notes:** Full cold suite 409/60 green (was 397/58). Typecheck clean. Repo imports `../../blocks/index.js` for registry side-effect so validation works standalone. Still local — not pushed.

### 2026-05-21 15:40 UTC — Task 7.3
**Commit:** 10be0fa
**Done:** `POST /api/sites/:siteId/save-as-template` in a new `src/server/routes/templates.ts` router (mounted at /api in app.ts; will also host 7.4/7.6/7.9). Body `{ name, description?, slug?, page_ids?, include_brand_tokens? (default true) }`: 404 if site missing; captures all pages (created_at order) or the given `page_ids` (preserving order, 400 if any id isn't on the site); builds a `kind:'site'` template with `source_site_id` + (optional) the site's default brand tokens; slug derived from name via `slugifyName` when omitted. Reuses `createTemplate` so blocks are re-validated through the shared validator — 422 on TemplateValidationError, 409 on TemplateSlugConflictError.
**Tests added:** 7 — `tests/integration/templates-api.test.ts` (401 no-auth, capture-all + derived slug + persisted pages, include_brand_tokens:false, page_ids subset+order, foreign page_id 400, unknown site 404, dup slug 409).
**Next:** 7.4 (templates admin API — list/detail/delete)
**Notes:** Full cold suite 416/61 green (was 409/60). Typecheck clean. Still local — not pushed.

### 2026-05-21 15:43 UTC — Task 7.4
**Commit:** c467e91
**Done:** Templates admin API added to `src/server/routes/templates.ts`: `GET /api/templates` (newest-first list + pages_count; `?kind=site|page`, `?status=active|archived` default active), `GET /api/templates/:id` (template + ordered pages, 404 if missing), `DELETE /api/templates/:id` (archive — soft delete, idempotent, 404 if missing). All `requireAdmin`, delegating to the repo.
**Tests added:** 4 (in templates-api.test.ts) — GET list 401 no-auth, list active + kind filter + pages_count, GET detail + ordered pages + 404, DELETE archives (hidden from active list, still fetchable) + 404.
**Next:** 7.5 (materialization job — pg-boss, D-019/D-042)
**Notes:** Full cold suite 420/61 green (was 416/61). Typecheck clean. Still local — not pushed.

### 2026-05-21 15:47 UTC — Task 7.5
**Commit:** d0ac371
**Done:** `template.materialize` pg-boss job (D-042). `src/server/jobs/materialize-template.ts` (`handleMaterializeTemplate({siteId,templateId})`): loads site + template, in one transaction inserts each template page into `pages` with `ON CONFLICT (site_id, slug) DO NOTHING` (created get a `source:'import'` revision), adopts the template's brand tokens only when the site has none, then evicts the resolver cache for the site's hostnames. Idempotent by construction (re-run = 0 created / N skipped, tokens untouched). Captured blocks keep source `asset_id`s — media shared by reference (D-043). Registered as `TEMPLATE_MATERIALIZE` in jobs/index.ts. Recorded **D-041** (data model), **D-042** (pg-boss materialization), **D-043** (media-by-reference).
**Tests added:** 5 — `tests/integration/materialize-template.test.ts` (materialize empty site + adopt tokens + import revisions; idempotent re-run; doesn't override existing tokens; slug-collision skip preserves the existing page; throws on unknown site/template).
**Next:** 7.6 (create-site-from-template endpoint)
**Notes:** Full cold suite 425/62 green (was 420/61). Typecheck clean. The new queue's registration is exercised by the existing jobs boot test. Still local — not pushed.
