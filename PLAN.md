# AnchorCorps Site Builder — Master Plan

> **Routine instructions:** This is the master state file. Update checkboxes here as phases complete. Detailed task lists live in `PHASE-XX-name.md` files. Append to `DECISIONS.md` when making architecture choices, `BLOCKERS.md` when you need human input, and `DEMO-LOG.md` when there's something visible to show. Send emails per the triggers in `.routine/EMAIL-TRIGGERS.md`.

## Context

This repo started life as the AnchorCorps **core site template** — a working Node/Express + React + Postgres app with auth, blog, events, and the basic shell of a website. The mission is to evolve it into a **multi-tenant site builder** where:

- Pages are stored as block JSON, not hardcoded React routes
- Admins edit sites visually with an AI-powered on-page editor
- New sites can be provisioned from templates with one click
- Each site gets its own domain via Cloud Run domain mapping
- Global components live in a shared NPM package on GCP Artifact Registry — never reinvented per site
- Forms remain CRM embeds (CallTrackingMetrics SID handoff intact)
- Auth, blog, and events flows are copied into each new site (editable per-site, not hardwired to a central backend)

The existing template's auth, blog, and events flows must **keep working at every phase**. They are the reference implementations that will be copied into provisioned sites later.

## Architectural anchors (do not violate)

1. **Block JSON is the source of truth for pages.** No hardcoded routes for content pages. Every page renders from `pages.blocks` JSONB.
2. **Zod schemas are the contract.** Every block type has a Zod schema that validates props, types the React component, generates editor form fields, and is serialized into AI prompts.
3. **Global components are versioned and imported, never copy-pasted.** They live in `@anchorcorps/components` published to GCP Artifact Registry. Sites depend on a version.
4. **Multi-tenancy by `site_id`, not separate deployments.** One renderer service serves all sites, resolved by `Host` header.
5. **CTM script in HTML head, before bundle JS.** Phone numbers render as plain `<a href="tel:…">` inside memoized `<PhoneNumber>` components that never re-render after mount.
6. **The CRM is a separate service.** Integration is exactly 5 HTTP endpoints — see Phase 11. No shared DB, no shared auth, no cross-service queries.
7. **No `<form>` tags inside React artifacts/editor previews.** Forms are CRM embeds rendered as inline HTML.
8. **Class prefix `ac-` is mandatory** on all global components. CSS uses custom properties (`--theme-main`, `--theme-accent`). No `font-family` declarations in component CSS. Font Awesome over inline SVG.

## Phase checklist

- [x] **Phase 1 — Block schema + renderer + first live multi-tenant site** *(see `PHASE-01-foundation.md`. All tasks 1.0–1.10 complete. Two production URLs live: `https://muldoon.sites.anchorcorps.com/` + `https://demo.sites.anchorcorps.com/`, both serving SSR'd block JSON over HTTPS via Cloud Run in `anchor-hub-480305`.)*
- [x] **Phase 2 — Global component library (`@anchorcorps/components` v0.1)** *(see `PHASE-02-component-library.md`. All tasks 2.1–2.10 complete. `@anchorcorps/components@0.1.0` published to GCP Artifact Registry; renderer consumes 6 ac-prefixed blocks — hero, hero-slider, cta, testimonial-carousel, logo-reel, faq-accordion — from the workspace symlink. Phase 1 hero/cta inline blocks removed; rich-text retained inline pending Phase 5 Tiptap.)*
- [x] **Phase 3 — Multi-tenant renderer (host resolution, brand tokens, media)** *(see `PHASE-03-multi-tenant-renderer.md`. All tasks 3.1–3.15 complete. resolveSite gains eviction + `/__site_resolve` debug; brand-token Zod schema (D-029) + per-page override merge; full D-022 media pipeline live — `media_assets` table, `gs://anchorcorps-media` bucket with 30-day Coldline lifecycle, pg-boss (D-030), signed-URL upload + sharp variant job emitting 5 sizes × 2 formats (D-031), `<Image>` block + hero-slider `image_asset_id` in `@anchorcorps/components@0.3.0` published to AR, end-to-end renderer hydration. Cloud CDN deferred to Phase 12.)*
- [x] **Phase 4 — Admin UI shell (control hub at `studio.anchorcorps.com`)** *(see `PHASE-04-admin-ui-shell.md`. All tasks 4.1–4.16 complete. Studio SPA served by the same Express+Vite process via `isAdminHost` (D-032); interim `X-Admin-Token` auth (D-034, Better-auth in Phase 8). Admin API under `/api` (list/create/detail/patch sites, pages, media). Screens: sites list, 2-step new-site wizard, site detail with Pages/Media/Settings tabs. Editor is a Phase-5 placeholder (D-017). Docs: `docs/admin-ui.md`.)*
- [x] **Phase 5 — Visual editor on Puck** *(see `PHASE-05-visual-editor.md`. Tasks 5.1–5.11 complete; 5.8 skipped by design — no per-block color props. `@measured/puck@0.20.2` lives entirely behind `src/editor/` (D-017/D-036): lossless `Block[]`↔`Data` adapter, schema-driven `zodToPuckFields`, `buildPuckConfig` from the block registry, custom fields for rich-text (Tiptap `3.23.5`, D-037) + image picker. Real editor at `/sites/:slug/pages/:pageId` — load→edit→publish via the existing save+revision API, revisions panel, publish/draft toggle. `Block[]` stays the source of truth; the prod renderer is unchanged. UI is jsdom/typecheck-tested; visual QA is operator-run. `docs/visual-editor.md`.)*
- [x] **Phase 6 — AI editing layer (Claude API, schema-validated edits)** *(see `PHASE-06-ai-editing.md`. Tasks 6.1–6.8 complete. `@anthropic-ai/sdk@0.97.1` + Claude Sonnet 4.6 pinned (D-038), stub/dry-run/api modes so no key = no spend. Block catalog from the registry via `zod-to-json-schema` (D-002). Tool-use edit contract — `insert/update/delete/move_block` → pure applier → `applyAndValidate` re-validates against the ONE shared validator extracted to `src/blocks/validate.ts` (D-039). `POST …/pages/:pageId/ai-edit` returns a schema-valid preview `{ proposed_blocks, diff }` and never saves; apply reuses the existing save endpoint with `source:'ai'` + a revision (D-040). "Ask AI" panel in the editor (no Puck import — D-017). Prompt caching of system+catalog, type-enum guardrail, dedicated AI rate limiter. `docs/ai-editing.md`. Live edits gated on the operator provisioning `ANTHROPIC_API_KEY` in Secret Manager.)*
- [x] **Phase 7 — Template system (save-as-template, new-from-template)** *(see `PHASE-07-templates.md`. Tasks 7.1–7.10 complete. Normalized `templates` + `template_pages` (D-041); save a site or single page as a reusable template (captured blocks re-validated through the shared registry validator, D-039); `GET/DELETE /api/templates` (archive, never hard-delete); create a new site from a `kind:'site'` template via the shared `createSiteWithDomains` primitive + an idempotent `template.materialize` pg-boss job (D-019/D-042) that imports pages and adopts brand tokens; add a page from a `kind:'page'` template synchronously. Media shared by reference — captured blocks keep source `asset_id`s, no copy (D-043). Studio: new-site wizard "Start from" template path + Save-as-template dialog + Pages-tab "Add from template". Built-in Starter seed (`npm run db:seed-templates`). `docs/templates.md`. 451 tests/66 files.)*
- [x] **Phase 7.5 — Plugin / integration framework** *(see `PHASE-07.5-plugins.md`. Tasks 7.5.0–7.5.10 complete. D-016 framework + D-044 (config storage: `config`/`config_encrypted` split, AES-256-GCM via `PLUGIN_CONFIG_ENC_KEY`) + D-045 (manifest contract, loader, in-repo reference plugin, AR distribution deferred). `site_plugins` table; `PluginManifest` + `registerPlugin()` runtime registry; loader composing registered manifests against `site_plugins` (`verifyPluginMigrations` fail-soft + `loadPlugins`); `req.site.plugins` populated; admin plugins API (list/enable/disable/config, secrets redacted); reference plugin `src/server/plugins/example/` (block + router + migration + config + secret + env, opt-in via `ENABLE_EXAMPLE_PLUGIN`); Studio Plugins tab; `docs/plugins.md`. Also split vitest into node+jsdom projects (killed FLAKE-RESOLVESITE). 506 tests/75 files. Concrete plugins like Stripe / PayPal / booking are post-7.5 packages, not master-plan phases.)*
- [ ] Phase 8 — Auth/blog/events copy-in pattern for provisioned sites *(see D-020: Better-auth as the auth library inside the per-site copy template; **also D-034**: studio control-hub login is built here too — Google OAuth via Better-auth, team-gated, no local auth — replacing Phase 4's interim X-Admin-Token)*
- [ ] Phase 9 — SEO layer (meta, sitemap, JSON-LD, editor SEO panel)
- [ ] Phase 10 — Domain provisioning (Cloud Run mapping, DNS, SSL)
- [ ] Phase 11 — CRM integration + CTM install
- [ ] Phase 12 — Hardening + first real client migration *(see D-021: install shared Plausible CE / Umami analytics instance; D-019 pg-boss workers; rate limiting, web-vitals, error tracking)*

Phases 2–12 are intentionally one-liners. Detailed phase files will be expanded when each phase is greenlit. **Do not start Phase 2 until human approval.**

## Routine cadence

- Work in **2–4 hour focused blocks**, one phase task at a time
- After each task: commit, update the phase MD file, check if a demo milestone or email trigger fires
- End of each work block: append to phase log section with what was done, what's next, any new blockers
- Daily: if a full day passes with no email-worthy progress, send a digest email summarizing where things stand

## Files the routine maintains

| File | Purpose | Update pattern |
|---|---|---|
| `PLAN.md` | This file — master phase checklist | Tick phase boxes only; do not edit prose without flagging |
| `PHASE-XX-name.md` | Per-phase task list + completion log | Tick boxes in place, append timestamped log entries |
| `DECISIONS.md` | Architecture decisions made during build | Append-only, never edit past entries |
| `DEMO-LOG.md` | Visible milestones with URLs to visit | Append on every demo-able milestone |
| `BLOCKERS.md` | Items needing human input | Append when raised, mark resolved with timestamp |
| `.routine/STATE.json` | Machine-readable routine state | Updated on every task transition |
| `.routine/EMAIL-TRIGGERS.md` | When and what to email | Reference only — do not modify |

## Definition of done — overall project

The site builder is "done" (v1) when:

1. A new site can be provisioned from a template via the admin UI in under 5 minutes
2. The provisioned site has a working custom domain with SSL
3. Pages can be edited visually with AI assistance and saved as revisions
4. The site can be saved back as a new template
5. Forms work end-to-end with CTM SID handoff to the existing CRM
6. At least one real client site has been migrated off WordPress and is in production

Phase 1's job is to make milestones 1–3 *possible* by establishing the data model and rendering foundation everything else builds on.
