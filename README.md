# AnchorCorps Site Builder

A multi-tenant, block-driven, **AI-editable** website platform. It started as the
AnchorCorps core site template and is being evolved phase-by-phase by a daily
Claude routine.

> **📋 The master phase plan is [`PLAN.md`](PLAN.md)** — the full phase
> checklist (Phases 1–12) and the architectural anchors. That's the file that
> outlines every phase. `ROUTINE-README.md` explains how the routine operates;
> `.routine/STATE.json` is the live machine-readable state; `DECISIONS.md` is the
> append-only architecture log.

> **Status (2026-05-21): Phases 1–6 complete and live in production.** The
> platform serves multi-tenant pages from block JSON, edits them visually (Puck)
> **and with AI** (Claude), publishes with append-only revisions, and provisions
> sites + custom domains. **Phase 7 (template system) is next** and starts only
> after `.routine/NEXT-PHASE-APPROVED` lands.

## Phase status

`PLAN.md` is the source of truth; quick summary:

| Phase | Status | Summary | Detail |
|---|---|---|---|
| 1 — Foundation | ✅ | Block schema + Zod registry + multi-tenant renderer + revisions | `PHASE-01-foundation.md` |
| 2 — Component library | ✅ | `@anchorcorps/components` on GCP Artifact Registry (6 `ac-` blocks) | `PHASE-02-component-library.md` |
| 3 — Multi-tenant renderer | ✅ | Host→site resolution, brand tokens, GCS media pipeline | `PHASE-03-multi-tenant-renderer.md` |
| 4 — Admin shell | ✅ | Studio control hub at `studio.anchorcorps.com` (interim X-Admin-Token) | `PHASE-04-admin-ui-shell.md` |
| 5 — Visual editor | ✅ | Puck editor at `/sites/:slug/pages/:pageId` | `PHASE-05-visual-editor.md` |
| 6 — AI editing | ✅ | Claude proposes schema-validated `Block[]` edits; preview → apply | `PHASE-06-ai-editing.md` |
| 7 — Templates | ⬜ **next** | save-as-template / new-from-template | (needs approval) |
| 7.5 — Plugins | ⬜ | manifest contract, `site_plugins`, loader (D-016) | — |
| 8 — Auth copy-in | ⬜ | Better-auth per-site + studio Google OAuth (D-020/D-034) | — |
| 9–12 | ⬜ | SEO, domains, CRM + CTM, hardening + first migration | see `PLAN.md` |

## Architectural anchors (do not violate)

Pulled from `PLAN.md`. Load-bearing; the routine raises a blocker rather than
working around them.

1. **Block JSON is the source of truth for pages.** Every page renders from
   `pages.blocks` JSONB — no hardcoded routes for content pages.
2. **Zod schemas are the contract.** One schema per block type validates props,
   types the React component, generates editor form fields, and serializes into
   AI prompts (D-002).
3. **Global components are versioned and imported**, never copy-pasted —
   `@anchorcorps/components` on GCP Artifact Registry (D-005).
4. **Multi-tenancy by `site_id`.** One renderer service; `Host` → `site_id` via
   `site_domains`.
5. **CTM script in HTML head, before bundle JS.** Phone numbers render as plain
   `<a href="tel:...">` inside memoized `<PhoneNumber>` components.
6. **CRM is a separate service** — integration is exactly 5 HTTP endpoints
   (Phase 11). The builder never touches PHI (D-006).
7. **No `<form>` tags inside React artifacts.** Forms are CRM embeds (inline HTML).
8. **`ac-` class prefix mandatory** on every global component. CSS uses custom
   properties (`--theme-main`, etc.); no `font-family` in component CSS; Font
   Awesome over inline SVG.

## Quick start (local)

```bash
docker compose up -d postgres                 # Postgres on host port 5434
cp .env.example .env                          # DATABASE_URL + TEST_DATABASE_URL
npm install
npm run migrate:up && npm run db:seed         # schema + 2 seeded sites
npm run dev                                    # Express + Vite middleware on :3000

# Try it
curl http://muldoon.localhost:3000/           # seeded muldoon home
curl http://demo.localhost:3000/              # different content + brand
# Studio control hub (admin + editors): http://studio.localhost:3000
```

Run the suite (boots against the test DB):

```bash
DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev \
TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test npm test
# → 394 passing across 58 files (Phase 6 close)
```

See `docs/local-dev.md` for hostname setup and `docs/deploy.md` for the deploy
bootstrap.

## Repo layout

```
src/
  blocks/        block registry + Zod schemas + the shared validator (validate.ts)
  editor/        Puck adapter/config/custom-fields — the ONLY Puck import boundary (D-017)
  admin/         Studio SPA: control hub, the visual editor route, the "Ask AI" panel
  server/
    ai/          Phase 6 AI editing service: client, catalog, edit-ops, propose, diff
    routes/      page (tenant), admin-pages (save/revisions/ai-edit), admin-sites, ...
    jobs/        pg-boss workers (image variants, ...) — D-019
    media/ dns/ gcloud/ provisioning/      media + domain provisioning
    email/       Mailgun client (stub/dry-run/api) — D-023
  middleware/    resolveSite, requireAdmin, rateLimit
  components/    SSR BlockRenderer + fallbacks
packages/
  components/    @anchorcorps/components (npm workspace, D-026)
db/              node-pg-migrate migrations (+rollbacks) + idempotent seed
docs/            subsystem docs (see below)
.routine/        STATE.json, baseline-tests.log, email templates, phase-approval files
tests/           smoke + integration (supertest, jsdom)
```

## Documents

- **`PLAN.md`** — master phase plan + architectural anchors. **Start here.**
- **`PHASE-01..06-*.md`** — per-phase task lists + completion logs.
- **`DECISIONS.md`** — append-only architecture decisions (D-001 … D-040).
- **`BLOCKERS.md`** — items needing human input (mark resolved, never delete).
- **`DEMO-LOG.md`** — visible / interactive milestones.
- **`ROUTINE-README.md`** — how the daily routine operates.
- `docs/data-model.md` — DB schema (`sites`, `pages`, `page_revisions`, media).
- `docs/blocks.md` — adding a new block type.
- `docs/components-publish.md` / `docs/components-consumption.md` — the package.
- `docs/media-pipeline.md` — GCS upload + variant generation (D-022/D-031).
- `docs/provisioning.md` — Cloud Run domain mapping + pluggable DNS provider (GoDaddy default).
- `docs/admin-ui.md` — the Studio control hub.
- `docs/visual-editor.md` — the Puck editor (Phase 5).
- `docs/ai-editing.md` — the AI editing layer (Phase 6).
- `docs/local-dev.md` / `docs/deploy.md` — local setup / Cloud Run deploy.

## Deploy

**CI is live (D-035): every push to `main` auto build → migrate → deploys
production** (`anchor-sites` on Cloud Run, GCP project `anchor-hub-480305`).
Keep `main` releasable — typecheck + the full cold test suite must be green
before every push. `docs/deploy.md` documents the pipeline; rollback = redeploy
a prior image tag.

## What's next

**Phase 7 — template system** (save a site/page as a reusable template;
create a new site from a template). It is not pre-drafted, so the next routine
run will draft `PHASE-07-templates.md` and confirm the task list before coding.
It won't start until `.routine/NEXT-PHASE-APPROVED` exists (PLAN.md hard rule #1).
