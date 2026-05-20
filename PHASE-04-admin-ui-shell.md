# Phase 4 — Admin UI shell (control hub)

> **Goal:** Stand up the admin control hub at `studio.anchorcorps.com` — a single React SPA where an operator lists sites, creates new ones, edits brand tokens, manages media, and lists pages. The page **editor** itself (drag-and-drop Puck) is Phase 5; Phase 4 ships the shell, navigation, lists, and the supporting read/write API. Token-based admin auth (`X-Admin-Token`) until Phase 8 swaps in Better-auth.

## Anchors that govern this phase

- **D-014** — Express + Vite middleware, single process. The admin SPA is served by the same Vite middleware as the legacy SPA; it just answers on a different host.
- **D-017** — Phase 5 wires Puck. Phase 4 leaves `/sites/:slug/pages/:pageId` as a placeholder route.
- **D-020** — Phase 8 replaces `requireAdmin` with Better-auth. Phase 4 keeps `X-Admin-Token`, pasted once at `/login`, stored in `localStorage`.
- **D-025** — `*.sites.anchorcorps.com` is the tenant layer. The admin host is a top-level sibling (`studio.anchorcorps.com`), NOT under `sites.`, so it never collides with the tenant resolver regex and isn't a cookie-parent of tenant hosts.
- **D-029** — Brand-token writes (new-site + settings) validate through `brandTokensSchema`.

## Decision to record during execution

- **D-032** — Admin control hub lives at `studio.anchorcorps.com`, a top-level sibling to the `*.sites.anchorcorps.com` tenant wildcard. Reasons: (1) not a DNS parent of tenant hosts → admin session cookies can't leak onto public tenant sites by default (clean Phase 8 auth boundary); (2) keeps the tenant resolver regex untouched; (3) "studio" pairs with the Phase 5 visual editor. Served by the same single Express+Vite process; an `isAdminHost(hostname)` guard short-circuits tenant resolution and serves the SPA.

## Tasks

### Host + routing foundation

- [ ] **4.1 — Provision `studio.anchorcorps.com` + admin-host routing**
  - **gcloud/DNS (assistant runs):** Cloud Run domain mapping for `studio.anchorcorps.com` on the `anchor-sites` service; Kinsta CNAME → `ghs.googlehosted.com.`; confirm cert provisioning kicks off.
  - **Server:** `src/config/admin-host.ts` → `isAdminHost(hostname)` recognizing `studio.anchorcorps.com`, `studio.localhost`, and a `STUDIO_HOST` env override. The page router (or a guard mounted before it) detects the admin host and serves the SPA instead of attempting tenant resolution. In dev, `studio.localhost:3000` serves the SPA; in prod the static `dist/index.html` serves for the admin host.
  - Append **D-032** to `DECISIONS.md`.
  - **Tests:** `isAdminHost` matches the three forms + rejects tenant hosts; an integration test that a request with `Host: studio.localhost` does NOT 404 as a missing tenant page.

### Admin API endpoints

- [x] **4.2 — `GET /api/sites` (list)**
  - Returns `[{ id, slug, display_name, status, created_at, pages_count }]`, newest first. `requireAdmin`.
  - **Tests:** auth gate; returns seeded sites with correct page counts.

- [x] **4.3 — `GET /api/sites/:siteId` + `GET /api/sites/:siteId/pages`**
  - Detail: `{ id, slug, display_name, status, default_brand_tokens, created_at, pages_count, media_count }`. 404 on unknown.
  - Pages list: `[{ id, slug, title, status, updated_at }]`, ordered by `updated_at desc`.
  - **Tests:** auth gates; detail counts; 404; pages ordering.

- [x] **4.4 — `GET /api/sites/:siteId/media` (list, paginated)**
  - `[{ id, alt, content_type, variants_status, variants, width, height, created_at }]`, newest first, `?limit&offset`. `requireAdmin`.
  - **Tests:** auth gate; returns ready + pending rows; pagination.

- [x] **4.5 — `POST /api/sites` (create)**
  - Body `{ slug, display_name, default_brand_tokens? }`. Slug validated (`^[a-z0-9][a-z0-9-]*$`, unique). Brand tokens via D-029. Inserts `sites` + the canonical `<slug>.<SITES_DOMAIN_BASE>` and `<slug>.localhost` `site_domains` rows (matches the seed). Returns the created site. `requireAdmin` + `rateLimit`.
  - **Tests:** auth gate; happy path (rows created + canonical hostname); duplicate slug 409; bad slug 400; bad brand tokens 400.

- [ ] **4.6 — `PATCH /api/sites/:siteId` + `POST /api/sites/:siteId/pages`**
  - PATCH: update `display_name` and/or `default_brand_tokens` (D-029); evict resolveSite cache for the site's hostnames. 404 on unknown.
  - Create page: `{ slug, title }` → inserts a `pages` row with empty blocks + an initial `page_revisions` entry. Duplicate `(site_id, slug)` → 409.
  - **Tests:** auth gates; PATCH updates + cache eviction; create page; duplicate slug 409; 404s.

### Admin SPA — structure

- [ ] **4.7 — Admin UI primitives + Tailwind/Vite wiring**
  - Vendor a small shadcn set into `src/admin/ui/`: `Button`, `Card`, `Input`, `Label`, `Dialog`, `Table`, `Badge`, `Spinner`. `cn` helper (`clsx` + `tailwind-merge` — add as root deps if not hoisted reliably).
  - Broaden `tailwind.config.js` `content` glob + ensure Vite scans `src/admin/**/*.tsx`.
  - **Tests:** a render smoke test for Button + Card (jsdom). (Admin tests run in the root vitest suite — may need a jsdom-env carve-out for `src/admin/**`.)

- [ ] **4.8 — Admin auth: token + fetcher + guard + login**
  - `src/admin/lib/useAdminToken.ts` (localStorage get/set/clear). `src/admin/lib/apiFetch.ts` attaches `X-Admin-Token`, throws typed errors on 401/4xx. `<RequireAdmin>` redirects to `/login` when no token; a `/login` screen pastes the token and verifies it against a lightweight `GET /api/sites` probe.
  - **Tests:** token hook roundtrip; apiFetch attaches header + maps 401; guard redirect logic (unit).

- [ ] **4.9 — Admin app shell + routing**
  - `src/admin/AdminApp.tsx` with its own `react-router` route table under the admin host. `src/App.jsx` dispatches to `<AdminApp />` when running on the admin host (detected client-side via `window.location.host`, matched against the same `isAdminHost` logic shared from `src/config/admin-host.ts`). Sidebar layout: brand, Sites nav, current-site breadcrumb, Sign out.
  - **Tests:** route table renders the sites list at `/`; unknown route → not-found.

### Admin SPA — flows

- [ ] **4.10 — Sites list (`/`)**
  - Table: display_name, slug, status badge, page count, created. Row click → `/sites/:slug`. "+ New site" button → `/sites/new`. Empty state with a create CTA when no sites.
  - **Tests:** renders rows from a mocked `GET /api/sites`; empty state.

- [ ] **4.11 — New-site wizard (`/sites/new`)**
  - 2-step: (1) slug + display_name (live slug validation), (2) brand-token color pairs (main/accent/surface + on-* derived) with a live preview swatch + "reset to defaults". Submits `POST /api/sites`; on success → `/sites/:slug`. Surfaces 409 (duplicate slug) inline.
  - **Tests:** step nav; validation; submit calls POST with the assembled body; duplicate-slug error surfaced.

- [ ] **4.12 — Site detail shell + tabs (`/sites/:slug`)**
  - Loads `GET /api/sites/:siteId` once. Tab bar: Pages · Media · Settings (default Pages). Tab content lazy-loads its list. Breadcrumb + "View live site" external link to the site's hostname.
  - **Tests:** tab switching; detail load; live-link href.

- [ ] **4.13 — Pages tab + new-page form**
  - List pages (4.3) with status badges + updated time. Each row has an "Edit" button → `/sites/:slug/pages/:pageId` (a Phase 5 placeholder screen: "Visual editor lands in Phase 5"). "+ New page" mini-form (slug + title) → `POST /api/sites/:siteId/pages` → refresh list.
  - **Tests:** renders pages; new-page submit; placeholder editor route renders.

- [ ] **4.14 — Media tab + upload flow**
  - Grid of media_assets (4.4) with thumbnail (smallest ready variant) + status. Upload widget: pick file → `POST /media/upload-url` → browser `PUT` to GCS → `POST /media/:id/complete` → optimistic "processing" card that flips to ready on refresh/poll. Shows alt + dimensions on hover.
  - **Tests:** renders grid; upload orchestration calls the three endpoints in order (mocked fetch + a stub PUT).

- [ ] **4.15 — Settings tab**
  - Edit display_name + brand tokens (same color-pair UI as the wizard step 2, pre-filled from `default_brand_tokens`). Save → `PATCH /api/sites/:siteId`. Success toast. Shows the site's hostnames (read-only; domain management is Phase 10).
  - **Tests:** loads current values; save calls PATCH with the diff; validation error surfaced.

### Wrap

- [ ] **4.16 — Phase 4 docs + plan tick**
  - `docs/admin-ui.md`: host model, auth, route map, how to run locally (`studio.localhost`), the Phase 5/8/10 hand-offs.
  - `DECISIONS.md` D-032 cross-referenced.
  - `PLAN.md` Phase 4 row ticked.
  - `.routine/baseline-tests.log` appended.

## Demo milestones (chat-only)

- Phase 4 started + `studio.anchorcorps.com` provisioned (after 4.1)
- Admin loads + sites list renders against real data (after 4.10)
- New-site wizard creates a site end-to-end (after 4.11)
- Media upload works from the UI (after 4.14)
- Phase 4 complete (after 4.16)

## Definition of done

- `studio.anchorcorps.com` resolves to the admin SPA in production (cert provisioned).
- An operator can: log in with the token, see all sites, create a new site, open a site, create a page, upload media, and edit brand tokens — all from the UI.
- The page **editor** is a labeled Phase-5 placeholder (not built here).
- Auth is still `X-Admin-Token` (Phase 8 replaces it).
- Full test suite green; new tests for every endpoint + key UI flow.
- `PLAN.md` Phase 4 row ticked.
- Phase 5 not started — wait for `.routine/NEXT-PHASE-APPROVED`.

## Completion log

<!-- Routine appends entries below this line, newest first -->

### 2026-05-19 19:10 UTC — Task 4.5 (POST /api/sites create)
**Commit:** (pending)
**Done:** `POST /api/sites` (requireAdmin + rateLimit 10/min). Zod-validated `{ slug, display_name, default_brand_tokens? }` — slug `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, brand tokens via D-029. In one transaction: inserts the `sites` row + two `site_domains` rows (canonical `<slug>.sites.anchorcorps.com` primary, `<slug>.localhost` for dev). Duplicate slug → 409 (checked inside the txn). Returns 201 with the created site + `canonical_hostname`.
**Tests added:** 5 (`admin-sites.test.ts`) — 401, happy path (site + both domain rows), 409 duplicate, 400 bad slug, 400 bad brand tokens. Full suite **251/251 across 36 files**; typecheck clean.
**Next:** 4.6 — PATCH site + create page.
**Notes:** Reuses `hostnameForSlug` + `getDomainConfig` from the domain config so the canonical hostname matches the seed + provisioning paths exactly. Does NOT run DNS/Cloud Run provisioning (that's Phase 10's `provisionSiteHostname`) — create just lands the DB rows; the site is reachable on `<slug>.localhost` immediately and on the canonical host once Phase 10 maps it.

### 2026-05-19 19:00 UTC — Task 4.4 (media list endpoint)
**Commit:** (pending)
**Done:** `GET /api/sites/:siteId/media` → `{ media: [...], total, limit, offset }`, newest first, `?limit` (1-200, default 50) + `?offset`. Returns ready + pending rows alike (the UI shows processing state). 404 if site missing.
**Tests added:** 4 (`admin-sites.test.ts`) — 401 gate, newest-first list with mixed statuses + total, limit/offset, 404. Full suite **246/246 across 36 files**; typecheck clean.
**Next:** 4.5 — POST /api/sites (create).

### 2026-05-19 18:50 UTC — Task 4.3 (site detail + pages list)
**Commit:** 3433e33
**Done:** `GET /api/sites/:siteId` → `{ site: { id, slug, display_name, status, default_brand_tokens, created_at, pages_count, media_count } }` (counts via correlated subqueries), 404 on unknown. `GET /api/sites/:siteId/pages` → `{ pages: [{ id, slug, title, status, updated_at }] }` ordered `updated_at desc`, 404 if the site doesn't exist.
**Tests added:** 5 (`admin-sites.test.ts`) — detail 401/200-with-counts-and-brand-tokens/404, pages list, pages 404. Full suite **242/242 across 36 files**; typecheck clean.
**Next:** 4.4 — media list endpoint.

### 2026-05-19 18:40 UTC — Task 4.2 (`GET /api/sites` list)
**Commit:** 902468a
**Done:** New `src/server/routes/admin-sites.ts` → `adminSitesRouter`, mounted under `/api` in `app.ts`. `GET /api/sites` (requireAdmin) returns `{ sites: [{ id, slug, display_name, status, created_at, pages_count }] }` via `LEFT JOIN pages` + `GROUP BY`, newest first. Houses 4.3–4.6 too.
**Tests added:** 3 (`tests/integration/admin-sites.test.ts`) — 401 gate, lists seeded sites with numeric page counts, created_at-desc ordering.
**Next:** 4.3 — site detail + pages list.
**Notes:** Separate router from `admin-pages.ts` (page save/revisions/restore). `admin-sites.ts` owns site-level CRUD + child lists. Task 4.1's actual commit was **2965eb4** (log field said "pending" due to a non-landing Edit).

### 2026-05-19 18:30 UTC — Task 4.1 (provision studio.anchorcorps.com + admin-host routing)
**Commit:** 2965eb4
**Done:** Cloud Run domain mapping `studio.anchorcorps.com` → `anchor-sites` + Kinsta CNAME → `ghs.googlehosted.com.` (DNS resolves; cert provisioning began). `src/config/admin-host.ts` (`isAdminHost` + `studioHost`, port-insensitive, `STUDIO_HOST` override, recognizes `studio.localhost`). `page.ts` short-circuits the admin host before `resolveSite` and passes through to the SPA. Appended **D-032** (cookie-boundary rationale + three-layer host model).
**Tests added:** 7 admin-host unit + 1 integration (studio.localhost passthrough). Also fixed a latent Task-3.5 cross-file test-pollution bug (admin-pages persisted `brand_tokens_override` on muldoon home; now reset in beforeEach/afterAll). Full detail in commit 2965eb4's message.
