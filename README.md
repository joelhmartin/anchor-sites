# AnchorCorps Site Builder

Multi-tenant site builder that started life as the AnchorCorps core site
template and is being evolved phase-by-phase into a block-driven, AI-editable
platform by a daily routine. See `PLAN.md` for the master phase plan and
`ROUTINE-README.md` for how the routine operates.

> **Phase 1 (Foundation) is complete.** The renderer serves multi-tenant
> pages from `pages.blocks` JSONB, gated by a Zod-validated block registry,
> with append-only revision history on every save. **Production deploy
> (Task 1.8) is blocked on operator GCP access** — see `BLOCKERS.md#B-001`
> and `docs/deploy.md`. Phase 2 starts after `.routine/NEXT-PHASE-APPROVED`
> lands.

## Architectural anchors (do not violate)

Pulled from `PLAN.md`. These are load-bearing; the routine raises a blocker
rather than working around them.

1. **Block JSON is the source of truth for pages.** No hardcoded routes for
   content pages — every page renders from `pages.blocks` JSONB.
2. **Zod schemas are the contract.** One schema per block type validates
   props, types the React component, generates editor form fields, and
   serializes into AI prompts.
3. **Global components are versioned and imported.** Phase 2 stands up
   `@anchorcorps/components` on GCP Artifact Registry; sites pin a version.
4. **Multi-tenancy by `site_id`.** One renderer service. `Host` header →
   `site_id` via `site_domains` (Task 1.5).
5. **CTM script in HTML head, before bundle JS.** Phone numbers render as
   plain `<a href="tel:...">` inside memoized `<PhoneNumber>` components
   that never re-render after mount.
6. **CRM is a separate service.** Integration is exactly 5 HTTP endpoints
   defined in Phase 11.
7. **No `<form>` tags inside React artifacts.** Forms are CRM embeds rendered
   as inline HTML.
8. **`ac-` class prefix mandatory** on every global component. CSS uses
   custom properties (`--theme-main`, `--theme-accent`). No `font-family`
   declarations in component CSS. Font Awesome over inline SVG.

## What Phase 1 shipped

| File / directory                                | What it gives you                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/blocks/`                                   | Registry + 3 block types (hero, rich-text, cta). Each has schema.ts + component.tsx + styles.css.       |
| `src/components/BlockRenderer.tsx`              | Walks a `Block[]`, validates each against the registry, falls back to `<UnknownBlock>` / `<BlockError>` |
| `src/middleware/resolveSite.ts`                 | `Host` → `site_id` with 60s in-process cache. `passThroughOnMiss` for SPA dev fallback.                 |
| `src/server/routes/page.ts`                     | Tenant catch-all. Renders `<BlockRenderer>` in a shell with the site's brand tokens + SEO meta.         |
| `src/server/routes/admin-pages.ts`              | Admin API: save (Zod-validates), list revisions, restore (non-destructive). X-Admin-Token + 10/min RL. |
| `src/server/routes/blocks-preview.tsx`          | Dev-only `/__blocks/preview` harness for ad-hoc block JSON testing.                                     |
| `src/server/email/send.ts`                      | Resend client — stub / dry-run / api modes. Renders templates from `.routine/templates/`.               |
| `src/server/routine-state.ts`                   | Atomic STATE.json read/write helper (tempfile + POSIX rename).                                          |
| `db/migrations/`                                | `sites`, `site_domains`, `pages`, `page_revisions` schema. GIN index on `blocks`. CHECK constraints.    |
| `db/seed.ts`                                    | Idempotent: 2 sites, 2 published home pages with real blocks, 4 `site_domains` rows.                    |
| `Dockerfile` + `cloudbuild.yaml`                | Cloud Run image + CI pipeline (`docs/deploy.md` walks the operator bootstrap).                          |
| `.routine/`                                     | Routine state, email templates, baseline log, approval files.                                           |

**80 tests** across smoke / integration / unit. Boot once with
`docker compose up -d postgres && npm test`.

## Quick start (local)

```bash
# 1. Bring up Postgres
docker compose up -d postgres

# 2. Env
cp .env.example .env
# (fill in DATABASE_URL + TEST_DATABASE_URL — defaults match docker-compose)

# 3. Migrate + seed
npm install
npm run migrate:up
npm run db:seed

# 4. Dev server
npm run dev                       # Express + Vite middleware on :3000

# 5. Try the demo
curl http://muldoon.localhost:3000/      # → seeded muldoon home (200 HTML)
curl http://demo.localhost:3000/         # → different content, different brand
curl http://localhost:3000/__site -i     # → 404 (localhost not a tenant)
curl http://localhost:3000/healthz       # → {"ok":true,"db":true}
```

See `docs/local-dev.md` for hostname setup details and `docs/deploy.md` for
the Cloud Run deploy bootstrap.

## Repo layout

```
src/
  blocks/                  # block type definitions + registry
  components/              # SSR components (BlockRenderer, fallbacks)
  middleware/              # resolveSite, requireAdmin, rateLimit
  server/
    app.ts                 # createApp() — assembles the Express app
    index.ts               # process entry: dev vs prod paths
    vite-dev.ts            # Vite middleware mount (dev only)
    db.ts                  # pg Pool + ping()
    render-page.tsx        # SSR helper used by the page route
    routes/                # blocks-preview, page, admin-pages
    email/                 # Resend wiring + template rendering
    routine-state.ts       # atomic STATE.json helper
  App.jsx, components/marketing/  # legacy SPA — preserved unchanged
db/
  migrations/              # node-pg-migrate files (forward + rollback)
  seed.ts                  # idempotent seed
docs/
  data-model.md
  local-dev.md
  deploy.md
  blocks.md                # how to add a new block type
.routine/
  STATE.json               # routine state (machine-readable)
  baseline-tests.log
  EMAIL-TRIGGERS.md
  templates/               # email templates the routine renders
tests/
  smoke/                   # baseline, spa, blocks-preview
  integration/             # schema, seed, resolveSite, page-render, admin-pages
```

## Documents

- **`PLAN.md`** — master phase plan + architectural anchors.
- **`PHASE-01-foundation.md`** — Phase 1 task list + completion log.
- **`DECISIONS.md`** — append-only architecture decisions (D-001..D-022).
- **`BLOCKERS.md`** — items needing human input.
- **`DEMO-LOG.md`** — visible / interactive milestones.
- **`ROUTINE-README.md`** — how the routine itself operates.
- **`docs/blocks.md`** — adding a new block type (the routine uses this).
- **`docs/data-model.md`** — Phase 1 schema.
- **`docs/local-dev.md`** — local development setup.
- **`docs/deploy.md`** — Cloud Run deploy walkthrough.

## What's next

Phase 2 builds `@anchorcorps/components v0.1` — the versioned component
library on GCP Artifact Registry. Will not start until
`.routine/NEXT-PHASE-APPROVED` exists (PLAN.md hard rule #1).
