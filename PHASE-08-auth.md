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

- [ ] **8.1 — Install + pin Better-auth; studio auth instance + mode switch.**
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

- [ ] **8.2 — Studio Better-auth tables migration (forward + rollback).**
  Author `db/migrations/<ts>_auth_studio.cjs` creating Better-auth's schema as
  `auth_user`, `auth_session`, `auth_account`, `auth_verification` (map
  Better-auth's table names to the `auth_*` convention). Rollback drops them.
  Confirm `deploy:db` (migrate step) picks it up. Test up→down→up clean against
  `anchor_test`. Reconcile the `auth_* RESERVED` note in `docs/data-model.md`.

- [ ] **8.3 — Mount studio auth handler on the Studio host only + team-gating.**
  Mount Better-auth's request handler (`/api/auth/*` + the `/auth/google/callback`
  redirect) behind the `isAdminHost` short-circuit (mirror `src/server/routes/
  page.ts`), so tenant hosts never expose it. Team-gating via a Better-auth hook
  (`databaseHooks.user.create.before` / sign-in callback): reject unless the
  Google `hd` claim `=== "anchorcorps.com"` OR the email is in
  `ADMIN_ALLOWED_EMAILS`. Tests (supertest, Google round-trip MOCKED): team
  email allowed; non-team `hd` rejected (no session); allowlisted email allowed.

- [ ] **8.4 — Flip `requireAdmin` to dual-mode (session OR token).**
  Rewrite `src/middleware/requireAdmin.ts`: (1) valid studio Better-auth session
  → allow; (2) else valid `X-Admin-Token` header → allow (CI/service/break-glass
  path); (3) local/non-prod with neither → auto-grant dev session; else 401.
  **Safety-critical / anti-lockout** — exhaustive unit tests for every branch
  (session-only, token-only, both, neither, prod vs non-prod). All existing
  `/api` routes inherit the new gate unchanged.

- [ ] **8.5 — Studio client login on Google.**
  Replace the token-paste `/login` with "Sign in with Google" (redirects to the
  Better-auth Google flow). `RequireAdmin.tsx` checks the session via
  `GET /api/auth/get-session` (or a small `/api/me`); `apiFetch.ts` uses
  `credentials:"include"` and drops `X-Admin-Token` from the human path (header
  still honored for scripts/tests). Add a sign-out control and a break-glass
  token-paste reachable at `/login?mode=token`. jsdom tests (fetch mocked):
  session present → app; absent → Google button; sign-out clears.

- [ ] **8.6 — Studio-auth docs + cutover runbook.**
  Update the auth section of `docs/admin-ui.md`; add `docs/studio-auth.md`
  (env/secrets, the redirect URI, dual-mode, break-glass, the cutover runbook).
  Record the operator prereq state (Google Client ID + `BETTER_AUTH_SECRET` in
  Secret Manager; until then prod runs dual-mode on the token). **Confirm with
  the operator before the first prod-deploying push** (ships the `auth_*`
  migration + dual-mode `requireAdmin`; dual-accept means no lock-out even
  before the secret lands).

---

## Track B — Per-site auth/blog/events (D-008/D-020, multi-tenant by site_id)

- [ ] **8.7 — Reconciliation decision + tenant-auth data model.**
  Record **D-047** (amends D-008 per the confirmed reconciliation above). Migration
  `db/migrations/<ts>_tenant_auth.cjs`: `tenant_auth_user/session/account/
  verification`, each with `site_id` (FK → `sites.id` ON DELETE CASCADE) and
  uniqueness scoped by `(site_id, …)`; plus `tenant_auth_config (site_id PK,
  providers jsonb, …)` for per-site provider enablement. Forward + rollback;
  test up/down.

- [ ] **8.8 — Request-scoped tenant Better-auth.**
  `src/server/auth/tenant-auth.ts`: `getTenantAuth(siteId)` → a per-site Better-
  auth instance (cached by `site_id`) whose adapter is constrained to that
  `site_id` (shared-tables + `site_id` scoping — finalize the exact mechanism,
  record **D-048**), with providers from `tenant_auth_config`. Mount the tenant
  auth handler at `/api/auth/*` on TENANT hosts only (via `req.site`), distinct
  from the studio handler. Tests (mocked): two sites' users isolated; per-site
  provider config respected.

- [ ] **8.9 — Blog data model + repo.**
  Migration: `posts (id, site_id FK ON DELETE CASCADE, slug, title, excerpt,
  body jsonb = Block[], status CHECK draft|published, published_at, author_id →
  tenant_auth_user nullable, created/updated; UNIQUE(site_id, slug); GIN(body);
  INDEX(site_id, status, published_at))`. Forward+rollback. `src/server/blog/
  {schema,repo}.ts` (Zod + pool-injected repo); body re-validated through the
  shared block validator (D-039) on write. Tests.

- [ ] **8.10 — Events data model + repo.**
  Migration: `events (id, site_id FK ON DELETE CASCADE, slug, title, description
  jsonb = Block[], starts_at, ends_at nullable, location, status, created/
  updated; UNIQUE(site_id, slug); INDEX(site_id, starts_at))`. Forward+rollback.
  `src/server/events/{schema,repo}.ts`. Tests.

- [ ] **8.11 — Public blog/events rendering on tenant hosts.**
  Routes `/blog`, `/blog/:slug`, `/events`, `/events/:slug` resolved via
  `req.site` (mounted after `resolveSite`, before the catch-all page router,
  tenant hosts only — never Studio). SSR through the existing block renderer
  (body = `Block[]`). Only `published` items are public; unknown slug → 404.
  Tests (supertest, seeded site).

- [ ] **8.12 — Provision-time copy-in hook.**
  Extend `createSiteWithDomains` (or a post-create hook reusing the
  materialization pattern, D-042) to seed per-site defaults at provision: a
  `tenant_auth_config` row (default providers) + optional starter blog index +
  sample post + events index. Idempotent (safe re-run). **This is the
  "copy-in."** Tests: new site gets the scaffolding; re-run is a no-op.

- [ ] **8.13 — Studio UI: Blog + Events + Members tabs.**
  New site-detail tabs: Blog (list/create/edit posts — edit body via the Puck
  editor since body = `Block[]`), Events (list/create/edit), Members/Auth (view
  tenant users, toggle per-site providers). Admin API (gated by `requireAdmin`,
  scoped by `site_id`) for blog/events/`tenant_auth_config` CRUD. jsdom tests
  (Puck stubbed per D-036, fetch mocked).

- [ ] **8.14 — Per-client divergence (doc) + tenant docs + DECISIONS.**
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
