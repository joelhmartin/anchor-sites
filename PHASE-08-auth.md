# Phase 8 — Auth: studio login + per-site auth/blog/events copy-in

> EXPANDED for operator sign-off 2026-05-26 (EXPAND gate). **NOT yet
> confirmed / NOT started** — awaiting in-chat go-ahead (hard rule #1; the
> routine will create then consume `.routine/NEXT-PHASE-APPROVED` on go).
> Builds on Phase 4's Studio shell + `requireAdmin` (D-034), the
> `isAdminHost` host boundary (D-032), `createSiteWithDomains` (D-008/P7-T7.6),
> the block renderer (D-001), pg-boss (D-019), and the plugin framework
> (D-016/D-045). Implements **D-034** (studio Google OAuth) + **D-020/D-008**
> (per-site auth/blog/events). Baseline to protect: **506 tests / 75 files**
> cold-green.

## Two tracks (operator-chosen ordering, 2026-05-26)

- **Track A — Studio control-hub login (D-034).** Do FIRST. Higher immediate
  value, retires the token UX, fully specified, lower architectural risk (the
  risk is operational: never lock the operator out of prod Studio).
- **Track B — Per-site auth/blog/events (D-008/D-020), multi-tenant by
  `site_id` + plugins.** After A. Larger/architectural.

## Confirmed design decisions (operator, 2026-05-26)

1. **Scope/order:** Track A first, then Track B, both in Phase 8.
2. **X-Admin-Token fate:** KEEP as a documented CI/service path (provisioning
   scripts + integration tests + break-glass). Google session becomes the human
   login; `requireAdmin` accepts EITHER → no lock-out during/after cutover.
3. **Track B reconciliation (the D-008 ↔ D-003 fork):** ONE shared renderer.
   auth/blog/events data scoped by `site_id`; Better-auth configured per-site;
   blog/events are content editable in Studio. **"Copy-in" = seeding per-site
   config + starter content at provision** (reuses the Phase-7 materialization
   pattern, D-042), NOT forked code. Deep per-client behavioral divergence rides
   the plugin framework (D-016/D-045). Amends D-008's "copied code" wording →
   new **D-047**.

## Design notes carried into the tasks (flagged at sign-off)

- **Studio OAuth callback path is aligned to the already-documented operator
  prereq URI** `https://studio.anchorcorps.com/auth/google/callback` — Phase 8
  configures Better-auth's basePath/callback to that exact path so the operator
  does NOT have to redo the Google Console redirect-URI step. (Better-auth's
  default would be `/api/auth/callback/google`; we override it.)
- **Table naming:** Studio (internal-team) auth uses `auth_*` (honors the
  `auth_* RESERVED` note in `docs/data-model.md`). Tenant (per-site) auth uses
  `tenant_auth_*` + a `site_id` column. The two auth surfaces never share rows.
- **Better-auth tenant multi-tenancy (8.8):** recommend SHARED `tenant_auth_*`
  tables + a `site_id` discriminator + a per-site request-scoped Better-auth
  instance (cached by `site_id`), over schema-per-site (simpler ops, no runtime
  DDL). Exact scoping mechanism finalized in 8.8 → **D-048**.
- **Blog/events body = `Block[]`** (D-001), so posts/events render through the
  EXISTING block renderer and are editable with Puck (D-017) + AI (D-006),
  re-validated through the shared block validator (D-039). Not raw HTML.
- **Mode switch (mirror D-038/D-012):** Google secrets unset → OAuth disabled
  (prod stays on the token, no crash); local/non-prod → auto-granted dev
  session (no Google round-trip). No live Google call in dev or tests.

---

## Track A — Studio control-hub login (D-034)

- [x] **8.1 — Install + pin Better-auth; studio auth instance + mode switch.**
  Install `better-auth` at an EXACT pin (`--save-exact`, per the D-036/D-038 pin
  convention; bump deliberately). Create `src/server/auth/studio-auth.ts`:
  `betterAuth()` configured against the existing `pg` Pool, Google social
  provider (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), session signing
  (`BETTER_AUTH_SECRET`), httpOnly + **host-only** session cookie scoped to the
  Studio host (D-032), and `basePath` so the Google callback is
  `/auth/google/callback`. Mode switch: secrets unset → `disabled` (handler
  reports not-configured; prod stays on token); non-prod → `dev` (auto session).
  New env vars are Secret-Manager prereqs (no values committed — hard rule #8).
  Record **D-046** (pin + config + mode + callback path). Unit-test instance
  construction + mode resolution (no network, no key).

- [x] **8.2 — Studio Better-auth tables migration (forward + rollback).**
  Author `db/migrations/<ts>_auth_studio.cjs` creating Better-auth's schema as
  `auth_user`, `auth_session`, `auth_account`, `auth_verification` (map
  Better-auth's table names to the `auth_*` convention). Rollback drops them.
  Confirm `deploy:db` (migrate step) picks it up. Test up→down→up clean against
  `anchor_test`. Reconcile the `auth_* RESERVED` note in `docs/data-model.md`.

- [x] **8.3 — Mount studio auth handler on the Studio host only + team-gating.**
  Mount Better-auth's request handler (`/api/auth/*` + the `/auth/google/callback`
  redirect) behind the `isAdminHost` short-circuit (mirror `src/server/routes/
  page.ts`), so tenant hosts never expose it. Team-gating via a Better-auth hook
  (`databaseHooks.user.create.before` / sign-in callback): reject unless the
  Google `hd` claim `=== "anchorcorps.com"` OR the email is in
  `ADMIN_ALLOWED_EMAILS`. Tests (supertest, Google round-trip MOCKED): team
  email allowed; non-team `hd` rejected (no session); allowlisted email allowed.

- [x] **8.4 — Flip `requireAdmin` to dual-mode (session OR token).**
  Rewrite `src/middleware/requireAdmin.ts`: (1) valid studio Better-auth session
  → allow; (2) else valid `X-Admin-Token` header → allow (CI/service/break-glass
  path); (3) local/non-prod with neither → auto-grant dev session; else 401.
  **Safety-critical / anti-lockout** — exhaustive unit tests for every branch
  (session-only, token-only, both, neither, prod vs non-prod). All existing
  `/api` routes inherit the new gate unchanged.

- [x] **8.5 — Studio client login on Google.**
  Replace the token-paste `/login` with "Sign in with Google" (redirects to the
  Better-auth Google flow). `RequireAdmin.tsx` checks the session via
  `GET /api/auth/get-session` (or a small `/api/me`); `apiFetch.ts` uses
  `credentials:"include"` and drops `X-Admin-Token` from the human path (header
  still honored for scripts/tests). Add a sign-out control and a break-glass
  token-paste reachable at `/login?mode=token`. jsdom tests (fetch mocked):
  session present → app; absent → Google button; sign-out clears.

- [x] **8.6 — Studio-auth docs + cutover runbook.**
  Update the auth section of `docs/admin-ui.md`; add `docs/studio-auth.md`
  (env/secrets, the redirect URI, dual-mode, break-glass, the cutover runbook).
  Record the operator prereq state (Google Client ID + `BETTER_AUTH_SECRET` in
  Secret Manager; until then prod runs dual-mode on the token). **Confirm with
  the operator before the first prod-deploying push** (ships the `auth_*`
  migration + dual-mode `requireAdmin`; dual-accept means no lock-out even
  before the secret lands).

---

## Track B — Per-site auth/blog/events (D-008/D-020, multi-tenant by site_id)

- [x] **8.7 — Reconciliation decision + tenant-auth data model.**
  Record **D-047** (amends D-008 per the confirmed reconciliation above). Migration
  `db/migrations/<ts>_tenant_auth.cjs`: `tenant_auth_user/session/account/
  verification`, each with `site_id` (FK → `sites.id` ON DELETE CASCADE) and
  uniqueness scoped by `(site_id, …)`; plus `tenant_auth_config (site_id PK,
  providers jsonb, …)` for per-site provider enablement. Forward + rollback;
  test up/down.

- [x] **8.8 — Request-scoped tenant Better-auth.**
  `src/server/auth/tenant-auth.ts`: `getTenantAuth(siteId)` → a per-site Better-
  auth instance (cached by `site_id`) whose adapter is constrained to that
  `site_id` (shared-tables + `site_id` scoping — **D-048**, by wrapping
  Better-auth's own adapter), with providers from `tenant_auth_config`. Tests
  (mocked): two sites' users isolated. NOTE: the HTTP handler mount on tenant
  hosts is **deferred** (D-048) — nothing in Phase 8 consumes tenant auth over
  HTTP; it mounts when a tenant member-login surface needs it.

- [x] **8.9 — Blog data model + repo.**
  Migration: `posts (id, site_id FK ON DELETE CASCADE, slug, title, excerpt,
  body jsonb = Block[], status CHECK draft|published, published_at, author_id →
  tenant_auth_user nullable, created/updated; UNIQUE(site_id, slug); GIN(body);
  INDEX(site_id, status, published_at))`. Forward+rollback. `src/server/blog/
  {schema,repo}.ts` (Zod + pool-injected repo); body re-validated through the
  shared block validator (D-039) on write. Tests.

- [x] **8.10 — Events data model + repo.**
  Migration: `events (id, site_id FK ON DELETE CASCADE, slug, title, description
  jsonb = Block[], starts_at, ends_at nullable, location, status, created/
  updated; UNIQUE(site_id, slug); INDEX(site_id, starts_at))`. Forward+rollback.
  `src/server/events/{schema,repo}.ts`. Tests.

- [x] **8.11 — Public blog/events rendering on tenant hosts.**
  Routes `/blog`, `/blog/:slug`, `/events`, `/events/:slug` resolved via
  `req.site` (mounted after `resolveSite`, before the catch-all page router,
  tenant hosts only — never Studio). SSR through the existing block renderer
  (body = `Block[]`). Only `published` items are public; unknown slug → 404.
  Tests (supertest, seeded site).

- [x] **8.12 — Provision-time copy-in hook.**
  Extend `createSiteWithDomains` (or a post-create hook reusing the
  materialization pattern, D-042) to seed per-site defaults at provision: a
  `tenant_auth_config` row (default providers) + optional starter blog index +
  sample post + events index. Idempotent (safe re-run). **This is the
  "copy-in."** Tests: new site gets the scaffolding; re-run is a no-op.

- [x] **8.13 — Studio UI: Blog + Events + Members tabs.**
  New site-detail tabs: Blog (list/create/edit posts — edit body via the Puck
  editor since body = `Block[]`), Events (list/create/edit), Members/Auth (view
  tenant users, toggle per-site providers). Admin API (gated by `requireAdmin`,
  scoped by `site_id`) for blog/events/`tenant_auth_config` CRUD. jsdom tests
  (Puck stubbed per D-036, fetch mocked).

- [x] **8.14 — Per-client divergence (doc) + tenant docs + DECISIONS.**
  Document that deeper per-site behavior rides the plugin framework
  (D-016/D-045), NOT forked core code. Add `docs/tenant-sites.md` (the per-site
  auth/blog/events model). Update `docs/data-model.md` (`auth_*` now shipped;
  `tenant_auth_*`/`posts`/`events` added). Confirm D-047 + D-048 recorded.

- [ ] **8.15 — Phase 8 wrap.**
  Full COLD suite + typecheck green; tick PLAN Phase-8 box; close STATE; record
  the final baseline. Confirm the prod-deploy push with the operator (ships all
  auth migrations + dual-mode `requireAdmin` + tenant tables + public blog/events
  routes). STOP at the 8→9 boundary (Phase 9 = SEO layer) — fresh
  `.routine/NEXT-PHASE-APPROVED` required.

## Operator prerequisites (for the live cutover; build proceeds without them)

1. **Google OAuth Client ID + secret** (Console → APIs & Services → Credentials
   → Web application; redirect URI `https://studio.anchorcorps.com/auth/google/
   callback`; consent screen Internal) → Secret Manager (`anchor-hub-480305`).
2. **`BETTER_AUTH_SECRET`** (32+ random bytes) → Secret Manager, wired to Cloud
   Run. Until 1+2 land, prod Studio runs dual-mode on the X-Admin-Token.

## Completion log

<!-- Routine appends timestamped entries here as tasks complete. -->

### 2026-05-26 14:24 UTC — Task 8.1
**Commit:** _(this commit)_
**Done:** Installed `better-auth@1.6.11` (exact pin) + built `src/server/auth/studio-auth.ts` — the Studio Better-auth instance factory (`createStudioAuth`), cached singleton (`getStudioAuth`), env-driven mode switch (`resolveStudioAuthMode`: google/dev/disabled), Studio origin + `/auth/google/callback` helpers, and the `auth_*` table-name map. Recorded **D-046**; added the four new env vars (blank) to `.env.example`.
**Tests added:** 12 (`src/server/auth/studio-auth.test.ts`) — mode resolution (google/dev/disabled + partial config), origin/callback derivation (incl. the documented `/auth/google/callback` path, not Better-auth's default), instance construction (handler+api, no DB I/O), cached-singleton null-in-dev / instance-in-google.
**Next:** 8.2 — Studio Better-auth tables migration (`auth_*`, forward + rollback).
**Notes:** No DB use yet (instance is config-only). Mounting on the Studio host + the callback-forwarding shim + team-gating are 8.3; the `requireAdmin` dual-mode flip is 8.4. Prod stays on the X-Admin-Token until the operator provisions `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`BETTER_AUTH_SECRET` (mode "disabled" → token path; no lock-out). `createStudioAuth` return type is inferred (betterAuth generic-variance, see D-046).

### 2026-05-26 14:30 UTC — Task 8.2
**Commit:** _(this commit)_
**Done:** Authored `db/migrations/1747577000000_auth_studio.cjs` — Better-auth's `auth_user`/`auth_session`/`auth_account`/`auth_verification` tables, fields taken verbatim from `getAuthTables()` (better-auth@1.6.11). Column names kept CAMELCASE (created case-preserved/quoted) so they match Better-auth's Kysely quoted queries. FKs `auth_session.userId`/`auth_account.userId` → `auth_user` ON DELETE CASCADE; indexes on the userId/identifier/provider lookups; `email`/`token` unique. `deploy:db` (= `migrate:up`) globs the dir, so it's picked up with no script change. Updated `docs/data-model.md` (auth_* shipped; tenant_auth_*/posts/events moved to reserved).
**Tests added:** 3 (`tests/integration/auth-studio-schema.test.ts`) — all four tables exist; camelCase columns preserved; **Better-auth's real adapter round-trips a user** (create→findOne→delete) against the migrated columns (the meaningful proof that the DDL matches Kysely's quoted identifiers). Also verified migrate up→down→up by hand on anchor_test.
**Next:** 8.3 — mount the Studio auth handler on the Studio host + callback shim + team-gating.
**Notes:** Better-auth generates string `id`s, so `id` is `text` (not uuid). No `touch_updated_at` trigger — Better-auth manages `updatedAt` itself; DB `now()` defaults cover inserts.

### 2026-05-26 14:38 UTC — Task 8.3
**Commit:** _(this commit)_
**Done:** Mounted the Studio Better-auth handler. `src/server/auth/studio-auth-mount.ts` (`mountStudioAuth`) registers `/api/auth/*` + a `/auth/google/callback`→`/api/auth/callback/google` forwarding shim (matches the D-034 prereq URI), both gated to the Studio host via `isAdminHost` (tenant hosts `next()` through, leaving `/api/auth/*` free for Track-B tenant auth). Wired into `createApp` BEFORE `express.json()` (Better-auth reads the raw body); added `studioAuth?` to `CreateAppOptions` for test injection; no-op in dev/disabled mode. Team gate added to `studio-auth.ts`: pure `isAllowedStudioEmail` (Workspace domain `studioAllowedDomain`/`STUDIO_ALLOWED_DOMAIN` + `ADMIN_ALLOWED_EMAILS` allowlist) wired into Better-auth's `databaseHooks.user.create.before` (throws `APIError` FORBIDDEN), so non-team accounts can never be created → never get a session.
**Tests added:** 11 — 5 predicate unit tests (domain/allowlist/override/malformed/parse, in studio-auth.test.ts), 4 mount tests (studio-host handled / tenant-host falls through / callback shim reaches Better-auth / dev no-op, studio-auth-mount.test.ts), 2 gate integration tests driving Better-auth's REAL `internalAdapter.createUser` pipeline (non-Workspace rejected, Workspace allowed).
**Next:** 8.4 — flip `requireAdmin` to dual-mode (Studio session OR X-Admin-Token) + local dev session.
**Notes:** 532/78 cold-green; typecheck clean. Mounting uses `createApp({ studioAuth })` injection in tests to avoid env/singleton coupling; prod boot uses the `getStudioAuth()` singleton (null in dev/disabled → handler not mounted).

### 2026-05-26 14:43 UTC — Task 8.4
**Commit:** _(this commit)_
**Done:** Rewrote `src/middleware/requireAdmin.ts` to DUAL-MODE, priority-ordered: (1) valid Studio Better-auth session → allow (sets `req.studioUser`); (2) `X-Admin-Token` match → allow (CI/service/break-glass marker); (3) local dev auto-grant ONLY when `mode === "dev"` AND no `ADMIN_API_TOKEN` configured (so the integration suite, which sets the token, still enforces it); (4) else 401. Session check is `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`, wrapped so a backend error falls through. Added `req.studioUser` to the Express Request augmentation; `requireAdmin({ getAuth, getMode })` is injectable for tests. Anti-lock-out: because the token path always works while `ADMIN_API_TOKEN` is set, provisioning the Google secrets later can never 401 the admin surface.
**Tests added:** 7 (`src/middleware/requireAdmin.test.ts`) — session-allow, token-allow, 401 (token configured but missing/wrong), dev auto-grant (dev + no token), fail-closed (disabled + no token + no session), session-over-token precedence, session-backend-error → token fallback.
**Next:** 8.5 — Studio "Sign in with Google" client flow + break-glass token paste.
**Notes:** 539/79 cold-green — no regression across the admin integration suite (all set `ADMIN_API_TOKEN`, so they still gate on the token and assert 401 without it). The `getStudioAuth()` singleton is null in test env (no Google secrets) → session check is a fast no-op there.

### 2026-05-26 14:51 UTC — Task 8.5
**Commit:** _(this commit)_
**Done:** Studio client now authenticates by session, uniformly across modes. Server: `GET /api/me` (`src/server/routes/me.ts`, gated by `requireAdmin`) returns `req.studioUser` — session user / dev user / token marker — mounted in `createApp`. Client: `src/admin/lib/session.ts` (`fetchMe`, `signInWithGoogle` via Better-auth `/api/auth/sign-in/social`, `signOut`); `useStudioSession` hook (async probe → loading/authed/unauthed); `RequireAdmin` rewritten to verify via the hook (spinner → Outlet/redirect); `LoginPage` rebuilt around a "Sign in with Google" button with a break-glass admin-token form (revealed via `?mode=token` or a link, verified against `/api/me`); `apiFetch` now sends `credentials:"include"` (cookie) alongside the optional `X-Admin-Token`; `AdminLayout` sign-out calls the real `signOut` then routes to /login.
**Tests added:** 15 — `/api/me` integration (3: token/401/dev-grant), `session.ts` (5: fetchMe ok/401, Google redirect ok/throws, signOut), `RequireAdmin` async guard (3: authed/null/throw), `LoginPage` (4: Google default, OAuth start, error, break-glass token). Updated `AdminApp.test` to mock `useStudioSession` (routing stays deterministic).
**Next:** 8.6 — studio-auth docs + cutover runbook (closes Track A).
**Notes:** 554/83 cold-green; typecheck clean. The break-glass token form keeps the operator's chosen X-Admin-Token path reachable in the UI. Real Google sign-in is operator-verified at studio.anchorcorps.com once the Client ID + BETTER_AUTH_SECRET land (still mocked here).

### 2026-05-26 14:53 UTC — Task 8.6 (TRACK A COMPLETE)
**Commit:** _(this commit)_
**Done:** Added `docs/studio-auth.md` — the full Studio auth reference: dual-mode gate, the `google`/`dev`/`disabled` mode switch, env/secrets table, team gate, the exact `/auth/google/callback` redirect URI, the operator Console+Secret-Manager prerequisite, and a **zero-lock-out cutover runbook** (token works before/during/after the Google-secret flip) + break-glass instructions. Updated `docs/admin-ui.md` auth section to the Phase-8 reality (dual-mode), the local-run note (dev = no auth), and the Phase-8 hand-off (✅).
**Tests added:** none (docs-only; baseline unchanged at 554/83).
**Next:** 8.7 — Track B begins (reconciliation decision D-047 + tenant-auth data model).
**Notes:** **Track A (studio Google login, D-034) is complete (8.1–8.6).** Live cutover gated on the operator provisioning GOOGLE_CLIENT_ID/SECRET + BETTER_AUTH_SECRET; prod runs `disabled` (token) until then. PUSHED to main 2026-05-26 (ab86515..58c731e, operator-approved) — CI deploying.

### 2026-05-26 15:09 UTC — Task 8.7 (TRACK B begins)
**Commit:** _(this commit)_
**Done:** Recorded **D-047** (the D-008↔D-003 reconciliation: one renderer, auth/blog/events scoped by `site_id`, "copy-in" = per-site config + starter content at provision, divergence via plugins; amends D-008's "copied code" wording). Migration `1747578000000_tenant_auth.cjs`: `tenant_auth_user/session/account/verification` (Better-auth schema + `site_id` FK→sites CASCADE, camelCase columns) with **per-site uniqueness** (`UNIQUE(site_id,email)`, `UNIQUE(site_id,providerId,accountId)`) + `tenant_auth_config(site_id PK, providers jsonb)`. Updated `docs/data-model.md`.
**Tests added:** 2 (`tests/integration/tenant-auth-schema.test.ts`) — five tables exist; same email allowed across two sites but rejected twice within one site. Migrate up→down→up verified by hand.
**Next:** 8.8 — request-scoped tenant Better-auth (`getTenantAuth(siteId)` + the D-048 site_id scoping mechanism).
**Notes:** 556/84 cold-green; typecheck clean. Better-auth round-trip against these tables (incl. how `site_id` gets injected/scoped) is proven in 8.8 — this task is schema + decision only. Not pushed (Track B batches).

### 2026-05-26 15:46 UTC — Task 8.8
**Commit:** _(this commit)_
**Done:** `src/server/auth/tenant-auth.ts` — per-site Better-auth via `getTenantAuth(siteId)` (cached per site). **D-048** scoping: declares `site_id` as an `additionalField` on all four models and **wraps Better-auth's own adapter** (`scopedAdapter`) to inject `site_id` into `create` data and append it to the `where` on every read/write (findOne/findMany/update/updateMany/delete/deleteMany/count/consumeOne + recursive `transaction`). One base adapter per Pool, shared by all per-site wrappers. v1 = email+password (provider toggle via `tenant_auth_config`). Recorded **D-048**.
**Tests added:** 2 (`tests/integration/tenant-auth.test.ts`) — `site_id` auto-injected on create + same email allowed in two sites; a lookup in site A never returns site B's user, **even by site B's primary key** (the isolation proof).
**Next:** 8.9 — blog data model (`posts`, body = `Block[]`).
**Notes:** HTTP handler mounting DEFERRED (D-048) — no Phase-8 consumer; mounts when a tenant member-login surface lands. Wrapping the existing adapter (vs a hand-written `createAdapterFactory` adapter) kept this ~80 lines + low-risk; tenant-auth return types are inferred from builder fns (betterAuth generic-variance, cf. D-046).

### 2026-05-26 15:51 UTC — Task 8.9
**Commit:** _(this commit)_
**Done:** Blog model. Migration `1747579000000_posts.cjs` — `posts` (`site_id` FK→sites CASCADE, slug, title, excerpt, `body jsonb`=Block[], `status` CHECK draft|published, `published_at`, `author_id`→tenant_auth_user SET NULL; `UNIQUE(site_id,slug)`, `GIN(body)`, `INDEX(site_id,status,published_at)`, touch trigger). `src/server/blog/{schema,repo}.ts` — Zod input schemas + pool-injected repo (create/list/getBySlug/getById/update/delete), EVERY query scoped by `site_id`, body re-validated via `validateBlocks` (D-039), `published_at` stamped on first publish / cleared on revert. `docs/data-model.md` updated.
**Tests added:** 7 (`tests/integration/blog-repo.test.ts`) — draft vs published stamping, list+status filter, publish transition, per-site slug uniqueness, invalid-body rejection, site-scoped reads, scoped delete.
**Next:** 8.10 — events data model + repo.
**Notes:** 565/86 cold-green; typecheck clean. Repo imports `blocks/index.js` for the registry side-effect (validateBlocks needs registered types, same as templates repo). `PostInput`/`PostPatch` are `z.input` types so defaults are optional for callers.

### 2026-05-26 15:55 UTC — Task 8.10
**Commit:** _(this commit)_
**Done:** Events model, mirroring blog. Migration `1747580000000_events.cjs` — `events` (`site_id` FK→sites CASCADE, `description jsonb`=Block[], `starts_at` NOT NULL, `ends_at`, `location`, `status` CHECK draft|published; `UNIQUE(site_id,slug)`, `INDEX(site_id,starts_at)`, touch trigger). `src/server/events/{schema,repo}.ts` — Zod (dates via `z.coerce.date()`) + pool-injected repo (create/list/getBySlug/getById/update/delete), site-scoped, description re-validated (D-039). `docs/data-model.md` updated.
**Tests added:** 4 (`tests/integration/events-repo.test.ts`) — ISO-date coercion + starts_at ordering, per-site slug uniqueness, invalid-description rejection, scoped update/read/delete.
**Next:** 8.11 — public blog/events rendering on tenant hosts.
**Notes:** 569/87 cold-green; typecheck clean. `z.coerce.date()` types the input as `Date`, so typed callers pass `Date`; HTTP handlers parse `unknown` and the coercion handles ISO strings.

### 2026-05-26 16:00 UTC — Task 8.11
**Commit:** _(this commit)_
**Done:** `src/server/routes/blog-events.ts` (`blogEventsRouter`) — public `/blog`, `/blog/:slug`, `/events`, `/events/:slug` on TENANT hosts, mounted in `createApp` before the catch-all page router. Detail pages render the post/event `body` (`Block[]`) through the SAME `renderPage` shell + block renderer + media hydration as pages; list pages render a synthesized rich-text index (escaped). Published-only; unknown slug → site 404; admin/unknown host → `next()` (no hijack of Studio/SPA).
**Tests added:** 5 (`tests/integration/blog-events-render.test.ts`) — /blog lists published (hides drafts), /blog/:slug renders body via the block renderer, draft → 404, /events list + detail, unknown host falls through to downstream.
**Next:** 8.12 — provision-time copy-in hook (seed tenant_auth_config + starter content).
**Notes:** 574/88 cold-green; typecheck clean. `/blog`/`/events` are reserved paths (a page with slug "blog" would be shadowed — acceptable convention).

### 2026-05-26 16:03 UTC — Task 8.12
**Commit:** _(this commit)_
**Done:** `src/server/sites/copy-in.ts` (`seedSiteCopyIn`) — the per-site "copy-in" (D-047): seeds `tenant_auth_config` (default providers = email+password) + a **draft** "welcome" post, idempotently (`ON CONFLICT DO NOTHING`), inside the caller's transaction. Wired into `createSiteWithDomains`, so EVERY provisioned site (wizard + from-template) gets it. Draft (not published) so a fresh client site shows no stray public blog.
**Tests added:** 3 (`tests/integration/site-copy-in.test.ts`) — config row with default providers, draft welcome post, idempotent re-run.
**Next:** 8.13 — Studio Blog/Events/Members tabs + admin API.
**Notes:** 577/89 cold-green; typecheck clean — no regression to the admin-sites/from-template suites that share `createSiteWithDomains`. This is "auth/blog/events copied into each site" under one renderer = config + content, not forked code (D-047).

### 2026-05-27 — Task 8.13 (Studio Blog/Events/Members tabs + admin API)
**Commits:** 6 sub-item commits `0e0182d`..`259c210` (per the per-subitem cadence).
**Done:** The full Studio surface for per-tenant content, scoped by `site_id`, gated by dual-mode `requireAdmin`.
- **8.13a `0e0182d`** — `src/server/routes/admin-tenant.ts` (`adminTenantRouter`, mounted at `/api` in `createApp`): blog posts CRUD (`GET/POST /api/sites/:siteId/posts`, `GET/PUT/DELETE …/posts/:postId`). List omits the heavy `body` Block[] (mirrors the pages list); slug conflict → 409, invalid block body → 400 (D-039).
- **8.13b `d4217e8`** — events CRUD on the same router (`…/events[/:eventId]`); list omits `description`, soonest-first; ISO `starts_at` coerced.
- **8.13c `5db8595`** — members + auth-config: `GET …/members` (read-only `tenant_auth_user`, site-scoped, camelCase cols quoted) + `GET/PUT …/auth-config` (per-site providers; `.strict()` rejects unknown keys; upsert; default email+password when no row).
- **8.13d `47cd6b7`** — `BlockBodyEditor` (reusable Block[] editor wrapping the one Puck boundary, D-017) + `BlogTab` (list/create) + `PostEditorPage` at `/sites/:slug/posts/:postId` (metadata + body saved in one PUT). Wired into SiteDetailPage + AdminApp.
- **8.13e `547801e`** — `EventsTab` + `EventEditorPage` at `/sites/:slug/events/:eventId` (datetime-local start/end + description Block[]).
- **8.13f `259c210`** — `MembersTab` (member list + email+password provider toggle), read-only tab (no editor route).
**Tests added:** 45 across 8 files — 3 API integration suites (`admin-tenant-{blog,events,members}.test.ts`, 22 tests: auth gate, site-scoping/isolation, 404/409/400, publish stamping, provider upsert) + 5 jsdom suites (`BlogTab`/`EventsTab`/`MembersTab` tabs, `PostEditorPage`/`EventEditorPage` with Puck stubbed per D-036) + SiteDetailPage tab-presence assertions.
**Next:** 8.14 — per-client-divergence doc + `docs/tenant-sites.md` + data-model update + confirm D-047/D-048 recorded.
**Notes:** 622/97 cold-green (+45/+8 over 577/89); typecheck clean. One renderer, one editor, one block registry — blog/events bodies are `Block[]` edited via the SAME Puck surface as pages (D-001/D-047). Track B remains LOCAL (batched push after 8.15, operator confirm).

### 2026-05-27 — Task 8.14 (docs + per-client-divergence)
**Commit:** _(this commit)_
**Done:** New `docs/tenant-sites.md` — the full per-site auth/blog/events reference: the one-renderer rule, the data model, tenant Better-auth scoping (D-048), public `/blog`+`/events` rendering, provision copy-in, the Studio admin API + Blog/Events/Members tabs, and an explicit **per-client-divergence boundary** (deeper behavior rides plugins D-016/D-045, never core forks). Appended a "Shipped (P8-T8.7–8.13)" paragraph to **D-047** in DECISIONS. Added a cross-link from `docs/data-model.md` and refreshed the `docs/admin-ui.md` route/tab table (Blog/Events/Members tabs + post/event editor routes; corrected the stale "Phase 5 placeholder" line).
**Tests added:** none (docs-only; baseline unchanged at 622/97).
**Next:** 8.15 — phase wrap (cold suite + typecheck, tick PLAN box, close STATE), then the operator-confirmed batched Track B prod push.
**Notes:** D-047 + D-048 confirmed present and current. `auth_*`, `tenant_auth_*`, `posts`, `events` all already documented in `docs/data-model.md` (P8-T8.2/8.7/8.9/8.10).
