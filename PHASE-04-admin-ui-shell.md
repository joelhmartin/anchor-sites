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

- [x] **4.6 — `PATCH /api/sites/:siteId` + `POST /api/sites/:siteId/pages`**
  - PATCH: update `display_name` and/or `default_brand_tokens` (D-029); evict resolveSite cache for the site's hostnames. 404 on unknown.
  - Create page: `{ slug, title }` → inserts a `pages` row with empty blocks + an initial `page_revisions` entry. Duplicate `(site_id, slug)` → 409.
  - **Tests:** auth gates; PATCH updates + cache eviction; create page; duplicate slug 409; 404s.

### Admin SPA — structure

- [x] **4.7 — Admin UI primitives + Tailwind/Vite wiring**
  - Vendor a small shadcn set into `src/admin/ui/`: `Button`, `Card`, `Input`, `Label`, `Dialog`, `Table`, `Badge`, `Spinner`. `cn` helper (`clsx` + `tailwind-merge` — add as root deps if not hoisted reliably).
  - Broaden `tailwind.config.js` `content` glob + ensure Vite scans `src/admin/**/*.tsx`.
  - **Tests:** a render smoke test for Button + Card (jsdom). (Admin tests run in the root vitest suite — may need a jsdom-env carve-out for `src/admin/**`.)

- [x] **4.8 — Admin auth: token + fetcher + guard + login**
  - `src/admin/lib/useAdminToken.ts` (localStorage get/set/clear). `src/admin/lib/apiFetch.ts` attaches `X-Admin-Token`, throws typed errors on 401/4xx. `<RequireAdmin>` redirects to `/login` when no token; a `/login` screen pastes the token and verifies it against a lightweight `GET /api/sites` probe.
  - **Tests:** token hook roundtrip; apiFetch attaches header + maps 401; guard redirect logic (unit).

- [x] **4.9 — Admin app shell + routing**
  - `src/admin/AdminApp.tsx` with its own `react-router` route table under the admin host. `src/App.jsx` dispatches to `<AdminApp />` when running on the admin host (detected client-side via `window.location.host`, matched against the same `isAdminHost` logic shared from `src/config/admin-host.ts`). Sidebar layout: brand, Sites nav, current-site breadcrumb, Sign out.
  - **Tests:** route table renders the sites list at `/`; unknown route → not-found.

### Admin SPA — flows

- [x] **4.10 — Sites list (`/`)**
  - Table: display_name, slug, status badge, page count, created. Row click → `/sites/:slug`. "+ New site" button → `/sites/new`. Empty state with a create CTA when no sites.
  - **Tests:** renders rows from a mocked `GET /api/sites`; empty state.

- [x] **4.11 — New-site wizard (`/sites/new`)**
  - 2-step: (1) slug + display_name (live slug validation), (2) brand-token color pairs (main/accent/surface + on-* derived) with a live preview swatch + "reset to defaults". Submits `POST /api/sites`; on success → `/sites/:slug`. Surfaces 409 (duplicate slug) inline.
  - **Tests:** step nav; validation; submit calls POST with the assembled body; duplicate-slug error surfaced.

- [x] **4.12 — Site detail shell + tabs (`/sites/:slug`)**
  - Loads `GET /api/sites/:siteId` once. Tab bar: Pages · Media · Settings (default Pages). Tab content lazy-loads its list. Breadcrumb + "View live site" external link to the site's hostname.
  - **Tests:** tab switching; detail load; live-link href.

- [x] **4.13 — Pages tab + new-page form**
  - List pages (4.3) with status badges + updated time. Each row has an "Edit" button → `/sites/:slug/pages/:pageId` (a Phase 5 placeholder screen: "Visual editor lands in Phase 5"). "+ New page" mini-form (slug + title) → `POST /api/sites/:siteId/pages` → refresh list.
  - **Tests:** renders pages; new-page submit; placeholder editor route renders.

- [x] **4.14 — Media tab + upload flow**
  - Grid of media_assets (4.4) with thumbnail (smallest ready variant) + status. Upload widget: pick file → `POST /media/upload-url` → browser `PUT` to GCS → `POST /media/:id/complete` → optimistic "processing" card that flips to ready on refresh/poll. Shows alt + dimensions on hover.
  - **Tests:** renders grid; upload orchestration calls the three endpoints in order (mocked fetch + a stub PUT).

- [x] **4.15 — Settings tab**
  - Edit display_name + brand tokens (same color-pair UI as the wizard step 2, pre-filled from `default_brand_tokens`). Save → `PATCH /api/sites/:siteId`. Success toast. Shows the site's hostnames (read-only; domain management is Phase 10).
  - **Tests:** loads current values; save calls PATCH with the diff; validation error surfaced.

### Wrap

- [x] **4.16 — Phase 4 docs + plan tick**
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

### 2026-05-20 11:05 UTC — Task 4.16 (Phase 4 docs + plan tick) — PHASE 4 COMPLETE
**Commit:** (pending)
**Done:** Wrote `docs/admin-ui.md` — host model (D-032 three-layer table + `isAdminHost` enforcement points), interim `X-Admin-Token` auth + the D-034 Phase-8 Google-OAuth hand-off, route map, full admin-API table, the slug→id resolution note, the three-step media upload flow (incl. the raw-PUT/no-token caveat), how to run locally on `studio.localhost:3000`, the UI building blocks, and the Phase 5/8/10 hand-offs. Ticked the **PLAN.md Phase 4 row** with a completion parenthetical matching the Phase 1–3 style. Appended the Phase 4 entry to `.routine/baseline-tests.log`. D-032 is cross-referenced from `docs/admin-ui.md` (no DECISIONS.md edit needed — append-only, and D-032/D-034 already exist).
**Tests added:** 0 (docs-only task). Full suite unchanged at **297/297 across 45 files**; typecheck clean.
**Next:** phase complete — Phase 5 (Puck visual editor) awaits `.routine/NEXT-PHASE-APPROVED`.
**Notes:**
- **Phase 4 definition of done met:** an operator can log in with the token, see all sites, create a site, open a site, create a page, upload media, and edit brand tokens — all from the UI. The editor is a labeled Phase-5 placeholder. Auth is still `X-Admin-Token`.
- **Prod is still behind:** prod runs commit `24a2ed3`'s image (Phases 2–4.10). 4.11–4.16 are on `main` but **not deployed** — the CI trigger is still unwired (operator follow-up; D-033 has the manual steps). No deploy attempted (hard rule #9 — needs operator approval).
- **PLAN.md prose note:** rule #5 says tick checkboxes only; I added a completion parenthetical to the Phase 4 row to match how Phases 1–3 are recorded. Flagging here per the rule.

### 2026-05-20 11:00 UTC — Task 4.15 (Settings tab) — admin can now do everything Phase 4 set out
**Commit:** 6eb970f
**Done:** `src/admin/pages/site-tabs/SettingsTab.tsx` is now real (last tab stub retired). Edits `display_name` + brand tokens, pre-filled from `default_brand_tokens` **merged over the defaults** so the whole palette is editable even for sites that only stored a couple of keys. Save computes a **diff** and `PATCH`es only the changed fields to `/api/sites/:siteId` (Save disabled until something changes / name non-empty); a green "Saved." confirmation appears on success; errors surface inline. A read-only card shows the canonical hostname (`tenantHostname(slug)`) with a "Phase 10" note. **Refactor:** extracted the wizard's color editor into a shared `src/admin/components/BrandTokenFields.tsx` (+ `DEFAULT_BRAND_TOKENS`) now used by both the wizard (4.11) and settings — single source for the color-pair UI + preview. Added `tenantHostname()` to `lib/siteUrl.ts` (and `liveSiteUrl` now builds on it).
**Tests added:** 4 (`SettingsTab.test.tsx`, jsdom) — loads current name + the site's `--theme-main` into the picker + shows the hostname; Save disabled until a change, then PATCHes **only** the changed field (display_name diff, colors untouched); a color change includes `default_brand_tokens` in the diff (and not display_name); a 400 surfaces inline. Re-ran `NewSiteWizard.test.tsx` after the extraction (still 4/4 — same labels/behavior) and updated `SiteDetailPage.test.tsx`'s Settings assertion to the real "Save changes" button. Full suite **297/297 across 45 files**; typecheck clean.
**Next:** 4.16 — Phase 4 docs + plan tick (the wrap task).
**Notes:**
- **Diff baseline = the merged initial tokens**, not the site's raw sparse tokens — so editing only the name doesn't spuriously also PATCH a full palette. A color edit (or name edit) is what puts that field in the body.
- `BrandTokenFields` is a controlled component (parent owns `tokens` + `onChange`); reset-to-defaults stays in each parent so the wizard (footer) and settings (inline) can place it differently.
- **Can't browser-verify** (operator hard rule). jsdom + typecheck only; eyeball at `studio.localhost:3000/sites/<slug>` → Settings.

### 2026-05-20 10:55 UTC — Task 4.14 (Media tab + upload flow) — media upload works from the UI
**Commit:** 0e64f0d
**Done:** `src/admin/pages/site-tabs/MediaTab.tsx` is now real. Loads `GET /api/sites/:siteId/media` and renders a responsive grid: ready assets show the **smallest ready variant** as a thumbnail (`pickThumb` sorts by width, webp on ties), pending/processing/failed assets show a status badge; alt + dimensions reveal on hover. The "Upload image" button drives a hidden `<input type=file>` through the **Phase-3 three-step flow**: `POST .../media/upload-url` (body `{content_type, alt:filename}`) → raw `fetch` `PUT` to the returned signed GCS `upload_url` with its `headers` (no admin token sent to GCS) → `POST .../media/:assetId/complete` → `reload()`. An optimistic "Uploading…" tile shows during the flow; a "Refresh" button re-pulls the grid so async variant processing flips tiles to ready. Upload errors surface inline. **Media upload now works end-to-end from the control hub.**
**Tests added:** 3 (`MediaTab.test.tsx`, jsdom) — grid renders ready thumbnail (asserts the *smallest* variant URL) + pending status badge; the upload flow calls upload-url → PUT → complete **in that order** (asserts the POST body + that the raw `File` is the PUT body); a failed storage PUT surfaces an inline error. Updated `SiteDetailPage.test.tsx` (4.12) again — Media tab is now real, so it mocks `/media` and asserts the "Upload image" affordance instead of the old stub text. Full suite **293/293 across 44 files**; typecheck clean.
**Next:** 4.15 — Settings tab (display_name + brand tokens via PATCH).
**Notes:**
- **Two fetch layers on purpose:** `apiFetch` for the two API hops (attaches `X-Admin-Token`), but a **raw `fetch`** for the PUT — sending the admin token to `storage.googleapis.com` would leak it. Called this out in a code comment.
- No polling timer (keeps jsdom tests deterministic) — the "Refresh" button + post-upload `reload()` cover "flips to ready on refresh." A poll can be added later behind the same `reload()`.
- **Can't browser-verify** (operator hard rule) — and the real GCS PUT especially can't be exercised here; it's mocked. jsdom + typecheck only; eyeball at `studio.localhost:3000/sites/<slug>` → Media.

### 2026-05-20 10:50 UTC — Task 4.13 (Pages tab + new-page form)
**Commit:** 7fe3e68
**Done:** `src/admin/pages/site-tabs/PagesTab.tsx` is now real (was a 4.12 stub). Loads `GET /api/sites/:siteId/pages` and renders a table — title, slug, status badge (`published`→success, `draft`→warning), last-updated date, and an "Edit" button that routes to `/sites/:slug/pages/:pageId` (the Phase-5 `EditorPlaceholder`). A toggleable "+ New page" mini-form (title + live-validated slug) submits `POST /api/sites/:siteId/pages`; on success it clears + closes the form and `reload()`s the list; a 409 (duplicate slug) surfaces inline. Empty/loading/error states all handled.
**Tests added:** 4 (`PagesTab.test.tsx`, jsdom) — lists pages with status badges; create posts the assembled `{slug,title}` body then the refreshed list shows the new page; Edit routes to the Phase-5 placeholder (`Visual editor — coming in Phase 5`); duplicate-slug 409 inline. Also updated `SiteDetailPage.test.tsx` (4.12) — its tab-switching test asserted the old Pages **stub** text + didn't mock the pages endpoint; now mocks `/pages` and asserts on the real "+ New page" affordance. Full suite **290/290 across 43 files**; typecheck clean.
**Next:** 4.14 — Media tab + upload flow.
**Notes:**
- Reused the `useApi` `reload()` from 4.10 for the post-create refresh — no manual list-state surgery.
- **Lesson for 4.14/4.15:** fleshing out a tab stub breaks any earlier test that asserted the stub's placeholder text. When I replace `MediaTab`/`SettingsTab`, re-check `SiteDetailPage.test.tsx` (it asserts `arrive in Task 4.14`/`4.15`) and the tab's own mock coverage.
- **Can't browser-verify** (operator hard rule). jsdom + typecheck only; eyeball at `studio.localhost:3000/sites/<slug>` → Pages tab.

### 2026-05-20 10:35 UTC — Task 4.12 (site detail shell + tabs)
**Commit:** aecb2eb
**Done:** `src/admin/pages/SiteDetailPage.tsx` is now the real detail shell. The URL routes by **slug** but the detail/pages/media endpoints key off the site **UUID**, so the page resolves slug → id from the (cheap) `GET /api/sites` list, then `<SiteDetailView>` loads the full detail via `GET /api/sites/:id`. Header: breadcrumb (`← Sites`), display_name + status badge, and a "View live site ↗" link to the canonical `<slug>.sites.anchorcorps.com` (new `lib/siteUrl.ts` helper mirroring the server `SITES_DOMAIN_BASE`; real domains are Phase 10). Tab bar (Pages · Media · Settings, default Pages) with `role=tab`/`aria-selected`; **only the active tab mounts**, so each tab's list fetch is lazy. Created stub tab components under `pages/site-tabs/` (`PagesTab`/`MediaTab`/`SettingsTab`) for 4.13–4.15 to flesh out — same staged-stub pattern 4.9 used for the page components. Shared `lib/siteTypes.ts` (`SiteListRow`/`SiteDetail`). Unknown slug → a "No site found" card with a back link.
**Tests added:** 4 (`SiteDetailPage.test.tsx`, jsdom + a URL-routing fetch mock) — slug→detail resolution (name + status), tab switching mounts only the active panel, "View live site" href = `https://acme.sites.anchorcorps.com` + `target=_blank`, unknown-slug not-found card. Full suite **286/286 across 42 files**; typecheck clean.
**Next:** 4.13 — Pages tab + new-page form.
**Notes:**
- **slug→id resolution chosen client-side (operator deferred to my judgment, "least error-prone").** The `:siteId` endpoints query a UUID column, so passing a slug would 500, not 404 — resolving to the id client-side from the list touches **zero** already-tested API code and matches the existing no-cache `useApi` philosophy. If the sites list ever gets large, swap to a by-id-or-slug endpoint behind the same call sites.
- The three tab files take the props their real versions need (`siteId`, `slug`, `site`) so 4.13–4.15 only change internals, not the call sites in `SiteDetailView`.
- **Can't browser-verify** (operator hard rule). Typecheck + jsdom-tested; eyeball at `studio.localhost:3000/sites/<slug>`.

### 2026-05-20 06:45 UTC — Task 4.11 (new-site wizard) — site creation end-to-end from the UI
**Commit:** fcd3902
**Done:** `src/admin/pages/NewSiteWizard.tsx` is now real — a 2-step wizard at `/sites/new`. Step 1: display_name + slug with live slug validation (regex mirrors the server `createSitePayload` exactly) — "Next" stays disabled until the name is non-empty and the slug is valid, with an inline error + a live `<slug>.sites.anchorcorps.com` hint. Step 2: three brand-color pairs (Main/Accent/Surface, each with a "text on …" companion) rendered as native `<input type="color">` pickers, a live preview swatch (surface card with Main/Accent chips), and a "Reset to defaults" button. Submits `POST /api/sites` with `{ slug, display_name, default_brand_tokens }`; on 201 → `navigate('/sites/:slug')`; a 409 surfaces inline ("slug already in use") instead of navigating. **An operator can now create a site entirely from the UI.**
**Tests added:** 4 (`NewSiteWizard.test.tsx`, jsdom + mocked fetch) — step nav (Next gated then advances to step 2), invalid-slug validation message + disabled Next, submit posts the assembled body to `/api/sites` (slug/display_name/`--theme-*` tokens asserted), duplicate-slug 409 surfaced inline. Full suite **282/282 across 41 files**; typecheck clean.
**Next:** 4.12 — site detail shell + tabs.
**Notes:**
- **Color pickers, not free-text hex.** `<input type="color">` always emits 6-digit hex, so the assembled `default_brand_tokens` is `brandTokensSchema`-valid by construction (D-029) — the only server error the wizard has to handle is the 409 duplicate slug. Free-text hex/`var()` editing can come with the Settings tab if needed.
- **Default tokens** seed all six `--theme-{main,accent,surface}` + `--theme-on-*` keys (D-029 kebab convention) so a new site renders with a complete palette, not just the two keys the seed sites carry.
- Follows the LoginPage precedent for the `<form>` element (admin auth/chrome, not a CRM embed or editor preview — the no-`<form>` anchor governs those surfaces).
- **Can't browser-verify** (operator hard rule — no Chrome automation here). Wizard is typecheck- + jsdom-tested; operator should eyeball at `studio.localhost:3000/sites/new`.

### 2026-05-19 20:30 UTC — Task 4.10 (sites list page) — first data-driven screen
**Commit:** (pending)
**Done:** `src/admin/lib/useApi.ts` — minimal GET hook (`{ data, loading, error, reload }`, fetch on mount + `reload()`). `SitesListPage` is now real: loads `GET /api/sites`, renders a table (name → links to detail, slug, status badge, page count, created date), "+ New site" → `/sites/new`, row-click → detail, an empty state with a CTA, a loading spinner, and an error card. **The control hub is now demoable end-to-end:** log in at `studio.localhost:3000/login` → land on the sites list rendering real data.
**Tests added:** 3 (`SitesListPage.test.tsx`, jsdom + mocked fetch) — rows render with counts, empty state + CTA, load-error surfaced. Full suite **278/278 across 40 files**; typecheck clean.
**Next:** 4.11 — new-site wizard.
**Notes:** `useApi` deliberately has no cache (admin is low-traffic; correctness over cleverness). A heavier client (react-query) can swap in behind the same call sites later. **Can't browser-verify** — the table/spinner/empty-state are typecheck + jsdom-tested; the operator should run `studio.localhost:3000` to eyeball.

### 2026-05-19 20:15 UTC — Task 4.9 (admin app shell + routing)
**Commit:** (pending)
**Done:** `src/admin/AdminApp.tsx` — the admin route tree: public `/login`, everything else behind `<RequireAdmin>` + `<AdminLayout>` (`/`, `/sites/new`, `/sites/:slug`, `/sites/:slug/pages/:pageId`, `*`). `src/admin/AdminLayout.tsx` — sidebar (brand, Sites nav, Sign out) + content outlet. `EditorPlaceholder` (Phase-5 landing per D-017) + `NotFound`. `src/App.jsx` dispatches to `<AdminApp />` when `isAdminHost(window.location.host)` (shared logic from `src/config/admin-host.ts`), else the legacy marketing/app routes. Stub page components (`SitesListPage`/`NewSiteWizard`/`SiteDetailPage`) land here for routing to resolve; 4.10–4.12 flesh them out.
**Tests added:** 5 (`src/admin/AdminApp.test.tsx`, jsdom + MemoryRouter) — no-token → login, authed → sites list + layout chrome, page-edit route → editor placeholder, unknown route → NotFound, `/login` always renders.
**Next:** 4.10 — real sites list page.
**Notes:**
- **Test-isolation fix:** RTL auto-cleanup wasn't firing between tests in a file (multiple-button leak). Added explicit `afterEach(cleanup)` to the RTL test files (`ui.test.tsx`, `AdminApp.test.tsx`). All admin component tests now isolate cleanly.
- Admin host detected client-side via `window.location.host` against the same `isAdminHost` the server uses — one source of truth for "is this the studio host."
- Full suite **275/275 across 39 files**; typecheck clean.

### 2026-05-19 19:55 UTC — Task 4.8 (admin auth: token + fetcher + guard + login)
**Commit:** (pending)
**Done:** `src/admin/lib/adminToken.ts` — localStorage get/set/clear + a `useAdminToken` hook backed by `useSyncExternalStore` (re-renders on token change, including the 401-clear). `src/admin/lib/apiFetch.ts` — JSON fetch wrapper that attaches `X-Admin-Token`, encodes the body, parses JSON, maps non-2xx to a typed `ApiError`, and clears the token on 401. `src/admin/auth/RequireAdmin.tsx` — route guard redirecting to `/login` (preserves attempted path in location state). `src/admin/auth/LoginPage.tsx` — token paste screen that probes `GET /api/sites` before persisting, so a bad token errors at login rather than on first action.
**Tests added:** 6 (`src/admin/lib/adminApi.test.ts`, jsdom) — token roundtrip, header attach + body encode, header omitted when no token, JSON parse on 200, 401→ApiError + token cleared, non-2xx→ApiError with server message + status. Full suite **270/270 across 38 files**; typecheck clean.
**Next:** 4.9 — admin app shell + routing (mounts these under the admin host).
**Notes:**
- `useSyncExternalStore` keeps every `useAdminToken` consumer in sync without a context provider — a 401 anywhere clears the token and the guard reacts.
- `LoginPage` form is the admin auth gate, not a CRM form (no PHI, no CTM) — noted in a comment so the "no `<form>` in React" anchor (which is about CRM embeds) isn't misread here.
- Guard + LoginPage are wired into the router in 4.9; 4.8 lands the logic + the lib tests.

### 2026-05-19 19:40 UTC — Task 4.7 (admin UI primitives + Tailwind/Vite wiring)
**Commit:** (pending)
**Done:** Vendored a small shadcn-style primitive set into `src/admin/ui/` — `cn`, `Button` (cva variants primary/secondary/outline/ghost/danger × sizes), `Card`+`CardHeader`+`CardTitle`+`CardContent`, `Input`, `Label`, `Badge` (tone variants), `Spinner` (CSS-only, role=status), `Table` family, `Dialog` (Radix). Indigo/zinc palette (admin chrome, distinct from the brand-token-driven public blocks). Barrel export at `src/admin/ui/index.ts`. Added root deps `@radix-ui/react-dialog`, `tailwind-merge`, `class-variance-authority` (clsx already present) + root devDeps `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. Broadened `tailwind.config.js` content glob to `./src/**/*.{js,jsx,ts,tsx}`.
**Tests added:** 5 (`src/admin/ui/ui.test.tsx`, `// @vitest-environment jsdom` per-file override) — Button element/type/variant, danger variant, Card composition, Badge tone, Spinner role. Full suite **264/264 across 37 files**; typecheck clean.
**Next:** 4.8 — admin auth (token + fetcher + guard + login).
**Notes:**
- **Vendored, not re-exported from `@anchorcorps/components`.** Admin chrome is renderer-internal; the package is for the public *site* surface (D-005). The duplication is small + the palettes differ (admin = indigo/zinc, blocks = brand tokens).
- **Caught a jsdom version drift:** installing `jsdom` at the root bumped the version the package's image test resolves, changing `aspect-ratio` normalization (`"1.5"` → `"1.5 / 1"`). Fixed the Task-3.12 assertion to strip the `/ 1` suffix — robust to both jsdom versions.
- **Can't browser-verify on this machine** (operator hard rule — no Chrome automation). UI is typecheck- + jsdom-tested; visual verification is the operator running `studio.localhost:3000`. Flagged in chat.

### 2026-05-19 19:20 UTC — Task 4.6 (PATCH site + create page) — ADMIN API COMPLETE
**Commit:** (pending)
**Done:** `PATCH /api/sites/:siteId` updates `display_name` and/or `default_brand_tokens` (D-029 validated; at-least-one required); after commit it evicts the resolveSite cache for every `site_domains` hostname so brand-token edits show up immediately (P3-T3.1 helper). `POST /api/sites/:siteId/pages` creates an empty `pages` row (`blocks=[]`, `status='draft'`) + an initial `page_revisions` row tagged `source='create'`, in one transaction. Duplicate `(site_id, slug)` → 409; unknown site → 404. **The admin API (4.2–4.6) is now complete** — the SPA can be built against it.
**Tests added:** 8 (`admin-sites.test.ts`) — PATCH 401/200/400-empty/400-bad-tokens/404; create-page 201-with-revision/409-dup/404. Full suite **259/259 across 36 files**; typecheck clean.
**Next:** 4.7 — vendored admin UI primitives + Tailwind/Vite wiring (the SPA build begins).

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
