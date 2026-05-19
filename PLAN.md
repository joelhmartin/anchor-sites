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

- [x] **Phase 1 — Block schema + renderer + first live multi-tenant site** *(see `PHASE-01-foundation.md`. Tasks 1.0–1.7 + 1.9–1.10 done locally. Task 1.8 production deploy gated by B-001 — operator GCP access needed.)*
- [ ] Phase 2 — Global component library (`@anchorcorps/components` v0.1) *(see D-018: shadcn/ui + Radix primitives + Embla Carousel under opinionated `ac-` prefixed blocks)*
- [ ] Phase 3 — Multi-tenant renderer (host resolution, brand tokens, media) *(see D-022: GCS + Cloud CDN + pre-generated variants via sharp + pg-boss; signed-URL direct uploads)*
- [ ] Phase 4 — Admin UI shell (sites list, new-site wizard skeleton)
- [ ] Phase 5 — Visual editor on Puck *(see D-017: Puck supplies drag-and-drop, side panel, undo/redo; we write a Zod→Puck-fields adapter and a `Block[]` ↔ Puck `Data` converter. Tiptap wraps as a custom Puck field for rich text. The "EditableWrapper / on-page" wording from earlier drafts is replaced by Puck's preview+side-panel UX.)*
- [ ] Phase 6 — AI editing layer (Claude API, schema-validated edits)
- [ ] Phase 7 — Template system (save-as-template, new-from-template)
- [ ] Phase 7.5 — Plugin / integration framework *(see D-016: manifest contract, `site_plugins` table, plugin loader, admin enable/disable. Concrete plugins like Stripe / PayPal / booking are post-7.5 packages, not master-plan phases.)*
- [ ] Phase 8 — Auth/blog/events copy-in pattern for provisioned sites *(see D-020: Better-auth as the auth library inside the per-site copy template)*
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
