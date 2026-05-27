# Tenant sites: per-site auth, blog & events

> Phase 8, Track B. Implements **D-047** (the per-site reconciliation) and
> **D-048** (tenant Better-auth scoping). This is the model for "every client
> site has its own blog, events, and member login" **under one renderer** — not
> per-site forked code.

## The one rule

There is **one** renderer service (D-003), resolved `Host → site_id`. Auth,
blog, and events are **features of that renderer with all data scoped by
`site_id`**. "Copied into each site" (D-008's original wording) means per-site
**data + config + starter content**, seeded at provision — never a per-site
code fork. Deeper per-client *behavior* (custom auth flows, paid memberships,
bespoke integrations) rides the **plugin framework** (`docs/plugins.md`,
D-016/D-045), also never a core fork. See **D-047** for the full reconciliation.

## Data model

All tables carry `site_id` and are scoped by it on every query. Full column
detail is in `docs/data-model.md`; the summary:

| Table | Purpose | Body field |
| --- | --- | --- |
| `tenant_auth_user` / `_session` / `_account` / `_verification` | Per-site visitor/member auth (Better-auth schema). `UNIQUE(site_id, email)` — the same person can be a member of two sites. | — |
| `tenant_auth_config` | Which login providers a site enables (`providers jsonb`). | — |
| `posts` | Per-site blog posts. `UNIQUE(site_id, slug)`. | `body` = `Block[]` |
| `events` | Per-site events (`starts_at`, `ends_at`, `location`). `UNIQUE(site_id, slug)`. | `description` = `Block[]` |

`body`/`description` being `Block[]` (D-001) is the whole point: blog and event
content renders through the **same** block renderer as pages, edits in the
**same** Puck editor (D-017), and is re-validated by the **same** block
validator (D-039). No second content system.

## Tenant auth (D-048)

`getTenantAuth(siteId)` (`src/server/auth/tenant-auth.ts`) builds and caches one
Better-auth instance per site. Better-auth has no built-in multi-tenancy, and
because `tenant_auth_user` is `UNIQUE(site_id, email)`, a `findOne`-by-email at
sign-in could otherwise match **another** site's user. The fix: **wrap
Better-auth's own adapter** — declare `site_id` as an `additionalField` on every
model, inject it on `create`, and append `{ field: "site_id", value: siteId }`
to the `where` on every read/write. A lookup in site A can never return site B's
row, even by site B's primary key (proven in `tests/integration/tenant-auth.test.ts`).

v1 enables **email + password**; the per-site provider toggle lives in
`tenant_auth_config`. Per-site social OAuth (needs per-site client IDs) is a
later refinement. The tenant HTTP login handler is mounted only once a member
sign-in surface ships (deferred — no Phase-8 consumer); the Studio internal-team
login (`auth_*`, `docs/studio-auth.md`) is a completely separate surface.

## Public rendering (P8-T8.11)

`blogEventsRouter` (`src/server/routes/blog-events.ts`) serves, on **tenant
hosts only** (admin/unknown hosts fall through):

- `GET /blog` — published posts, newest first (synthesized index).
- `GET /blog/:slug` — one post; `body` rendered through `renderPage` + the block renderer + media hydration.
- `GET /events` and `GET /events/:slug` — the same for events.

Drafts 404 publicly. `/blog` and `/events` are reserved paths (a page with one
of those slugs would be shadowed — accepted convention).

## Provision-time copy-in (P8-T8.12)

`seedSiteCopyIn` (`src/server/sites/copy-in.ts`) runs inside
`createSiteWithDomains`, so **every** provisioned site (wizard or
from-template) gets, idempotently:

- a `tenant_auth_config` row (default providers = email + password), and
- a **draft** "welcome" post (draft so a fresh site shows no stray public blog).

This is exactly what "auth/blog/events copied into each site" means under one
renderer: **config + content, not code** (D-047).

## Studio surface (P8-T8.13)

### Admin API — `adminTenantRouter` (`src/server/routes/admin-tenant.ts`)

Mounted at `/api`, gated per-route by dual-mode `requireAdmin` (Studio session
**or** `X-Admin-Token`, D-034/D-046), every query scoped by the `:siteId` path
param.

| Method + path | Purpose |
| --- | --- |
| `GET /api/sites/:siteId/posts[?status=]` | List posts (omits the heavy `body`) |
| `POST /api/sites/:siteId/posts` | Create a post (409 on duplicate slug, 400 on invalid body) |
| `GET/PUT/DELETE /api/sites/:siteId/posts/:postId` | Read full / update / delete |
| `GET /api/sites/:siteId/events[?status=]` | List events (soonest-first, omits `description`) |
| `POST /api/sites/:siteId/events` | Create an event |
| `GET/PUT/DELETE /api/sites/:siteId/events/:eventId` | Read full / update / delete |
| `GET /api/sites/:siteId/members` | Read-only list of `tenant_auth_user` (site-scoped) |
| `GET/PUT /api/sites/:siteId/auth-config` | Read / set per-site login providers (strict; rejects unknown keys) |

`PUT` to a post/event saves metadata **and** the `Block[]` body in one call.
Publishing stamps `published_at` on first publish and clears it on revert.

### Studio UI

`SiteDetailPage` gains **Blog**, **Events**, and **Members** tabs:

- **Blog / Events tabs** — list + inline create; **Edit** opens a Puck-backed
  editor (`PostEditorPage` at `/sites/:slug/posts/:postId`, `EventEditorPage` at
  `/sites/:slug/events/:eventId`). Both reuse `BlockBodyEditor`
  (`src/admin/components/BlockBodyEditor.tsx`), the one wrapper around the Puck
  boundary (D-017) — so blog/event bodies edit with the same editor + block
  registry as pages. Metadata + body save together in one PUT.
- **Members tab** — read-only member list (verified badge, joined date) + the
  per-site login-provider toggle (writes `tenant_auth_config`).

Puck's real drag-and-drop is operator-verified at the Studio host; jsdom tests
stub Puck (D-036) and assert the block ⇄ Puck round-trip + the save payloads.

## Per-client divergence — the explicit boundary

When a client needs behavior the shared renderer doesn't have (a bespoke
booking flow, gated/paid content, a third-party CRM sync), the answer is a
**plugin** (`docs/plugins.md`), **never** a fork of core renderer code. Plugins
contribute blocks, API routes, tables, and per-site config, enabled per-site —
the same shared-infra-plus-data/config/plugins principle as D-016 and D-047. If
you find yourself wanting to copy `src/server/...` for one client, that's the
signal to write a plugin instead.
