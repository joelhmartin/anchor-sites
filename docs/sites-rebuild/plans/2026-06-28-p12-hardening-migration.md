# Phase 12 — Hardening + First Real Client Migration

**Goal:** Ship the final hardening layer that closes out all deferred "Phase 12" items and
validates the full stack with the first real production client migration off WordPress.

Six tracks:
1. **Analytics injection** (D-054) — inject Plausible CE / Umami script per D-021 from the
   HTML shell; env-driven mode switch; per-site opt-out flag.
2. **Error tracking + React ErrorBoundary** (D-055) — Sentry mode-switch (real/stub/disabled),
   React ErrorBoundary in Studio, Express global error handler, optional web-vitals reporting.
3. **CSP hardening** (D-056) — enable `helmet.contentSecurityPolicy` (currently `false`) with
   directives covering CTM, analytics, CRM embed, media CDN.
4. **Rate-limit completion** — apply the existing `rateLimit()` middleware to the remaining
   unprotected mutation endpoints (AI edit, CRM proxy, tenant-facing non-GET routes).
5. **pg-boss observability** — admin health endpoint reporting queue depths + dead-letter
   visibility; worker-restart resilience guard.
6. **Client migration runbook** — `docs/migration.md` documenting the full WordPress →
   anchor-sites migration sequence; any final tooling gaps (bulk-CTM script, smoke-test CLI).

---

## What already exists (reuse, don't rebuild)

- **`render-page.tsx` `shell()`** — already has `headExtra` + `ctmScriptTag()` slots; analytics
  + web-vitals script tags follow the same `ctmScriptTag` pattern (inject before `headExtra`).
- **Env-driven mode switches** — `send.ts`, `crm/resolve.ts`, `dns/resolve.ts`, `client.ts`
  all use the same pattern; Sentry and analytics follow it exactly.
- **`helmet`** active in `app.ts` (line 43) with `contentSecurityPolicy: false`; flipping to a
  directives object is one config change.
- **`rateLimit()` middleware** in `src/middleware/rateLimit.ts` — injectable via router opts;
  already used on site-create, media upload, and admin CRUD. The same export applies to the
  remaining endpoints without touching the implementation.
- **`pg-boss` / `getBoss()`** bootstrapped (`src/server/jobs/index.ts`); three queues registered.
  A health endpoint reads boss's own `getQueueSize()` and `getDeadJobs()` APIs — no new schema.
- **`provision-site.ts` script** (`scripts/provision-site.ts`) — full provisioning CLI already
  exists; the migration runbook documents its use rather than rebuilding it.

---

## Design decisions

### D-054 — Analytics script injection (Plausible CE / Umami)

**Context:** D-021 specifies one shared Plausible CE / Umami instance serving all provisioned
client sites. Plausible and Umami both identify sites by the site's public domain — no extra
DB column needed. The script tag is injected into `<head>` from the server renderer (SSR, no
client hydration step).

**Decision:**
- `render-page.tsx` gains `analyticsScriptTag(domain, baseUrl): string` helper:
  ```html
  <!-- Plausible: -->
  <script defer
          data-domain="<domain>"
          src="<ANALYTICS_BASE_URL>/js/script.js"></script>
  <!-- Umami: uses data-website-id; same injection point -->
  ```
  Helper HTML-escapes `domain` and `baseUrl` attributes (same pattern as `ctmScriptTag`).
- Injected immediately after `ctmScriptTag` output (before `headExtra`) when both
  `ANALYTICS_BASE_URL` env var and the site's primary domain are present.
- Per-site opt-out: `sites.analytics_disabled BOOLEAN NOT NULL DEFAULT false` column
  (migration 12.1). When `true`, injection is skipped regardless of env config.
  Exposed in `ResolvedSite` and PATCH `/api/sites/:id` (alongside `ctm_account_id`).
- `analyticsScriptTag` is unit-tested for escaping, correct attribute names, and
  Plausible vs. Umami `ANALYTICS_PROVIDER` env switch (`plausible` = default,
  `umami` = `data-website-id` attribute variant).

### D-055 — Error tracking, ErrorBoundary, web-vitals

**Context:** D-021 / Phase 12 scope lists "error tracking" and "web-vitals" as hardening items.
No vendor is committed; Sentry is the de-facto standard and has a free tier. PHI constraint
(D-006) prohibits forwarding page content or form data — only stack traces and metric values.

**Decision:**

**Sentry integration** (env-driven mode switch, `src/server/sentry/resolve.ts`):
- `SENTRY_DSN` present → init `@sentry/node` + `@sentry/react`; real error capture.
- `SENTRY_DISABLED=true` → no-op (opt-out for clients who don't want external telemetry).
- Absent + dev → stub (log-to-console).
- Injectable `captureException(err)` function exported from `src/server/sentry/index.ts`
  and `src/client/sentry/index.ts`; callers never import `@sentry` directly.
- Express: add Sentry `requestHandler` + `errorHandler` middleware in `app.ts`. Also add
  a generic 4-param error handler that logs the stack and returns a JSON `{ error: "…" }`
  with appropriate HTTP status (masks 500s in production).
- React (Studio): `<SentryErrorBoundary>` wraps `<RouterProvider>` in `AdminApp.tsx`.
  Fallback: a simple "Something went wrong" card with a retry button. No Puck-specific
  boundary needed (Puck already handles render errors internally).

**Web-vitals reporting** (tenant renderer):
- Inject a small inline `<script>` snippet in `shell()` (after analytics) when
  `WEB_VITALS_ENDPOINT` is set. The snippet uses the `web-vitals` attribution IIFE
  from the CDN (no local bundle step for the SSR renderer).
- Reports LCP, CLS, FCP, TTFB, INP to `POST ${WEB_VITALS_ENDPOINT}` as a JSON body.
  Endpoint is optional — the global snippet is a no-op if the variable is absent.
- A minimal `POST /api/vitals` endpoint in `admin-crm.ts`-style module
  (`src/server/routes/vitals.ts`) accepts the metrics payload and logs / enqueues
  them (no persistent store in Phase 12 — a pg-boss job or plain `console.log` suffices
  until a metrics store is provisioned). `requireAdmin` NOT applied (tenant pages post to it).
  Rate-limited at 60 req/min per IP to prevent abuse.

### D-056 — Content Security Policy

**Context:** `helmet({ contentSecurityPolicy: false })` has been the interim config since
Phase 1. Phase 12 closes it with a CSP that covers all known script/style/connect origins.

**Decision:**
- Enable `helmet.contentSecurityPolicy` with the following base directives (applied globally
  to all routes via `app.ts`):
  ```
  default-src 'self';
  script-src  'self' 'unsafe-inline'   # vite HMR / legacy inline blocks
              cdn.calltracking.com     # CTM
              <ANALYTICS_BASE_URL>     # Plausible / Umami (runtime from env)
              unpkg.com;               # web-vitals IIFE CDN
  style-src   'self' 'unsafe-inline';  # Tailwind inline, Puck inline
  img-src     'self' data: storage.googleapis.com;  # GCS media CDN
  connect-src 'self' <WEB_VITALS_ENDPOINT> <SENTRY_DSN_ORIGIN>;
  frame-src   'none';
  object-src  'none';
  base-uri    'self';
  ```
- CRM embed (`crm_form` block): `dangerouslySetInnerHTML` renders an operator-authored embed;
  the CRM provider's domain is NOT hardcoded. Instead the CSP for `frame-src` / `connect-src`
  is extended by a new optional env var `CSP_CRM_EXTRA_ORIGINS` (comma-separated origins
  appended at runtime). Operator sets this to their CRM's domain.
- The CSP is constructed in a helper `buildCsp(env): string` (`src/server/csp.ts`) so
  it can be unit-tested and the env vars substituted at startup. `helmet` accepts a
  `directives` object so env-variable origins can be injected cleanly.
- `'unsafe-inline'` for scripts is a compromise while the legacy inline blocks exist;
  a future phase replaces it with a nonce-per-request approach. Document the gap.

---

## Tasks (per-subitem commits; TDD)

- **12.1** Migration `1747600000000_analytics_disabled.cjs`: add `analytics_disabled BOOLEAN
  NOT NULL DEFAULT false` to `sites`. Update `ResolvedSite` + `lookupSite` SELECT. Add
  `analytics_disabled` to PATCH `/api/sites/:id` patchable fields (Zod + DB update). Add
  CTM Account ID field to Studio `SettingsTab.tsx` (analytics on/off toggle). Unit +
  integration tests for PATCH field + resolveSite. Up/down/up migration cycle verified.

- **12.2** Analytics script injection (D-054): add `analyticsScriptTag(domain, baseUrl, provider)
  : string` to `render-page.tsx`. Update `shell()` to emit it before `headExtra` when
  `process.env.ANALYTICS_BASE_URL` is set and `site.analytics_disabled` is false. Unit tests:
  correct `data-domain` / `data-website-id` attribute, HTML escaping, Plausible vs. Umami
  variant, no-op when env absent or `analytics_disabled=true`. Integration smoke: page render
  for a site without `analytics_disabled` includes the script tag when env set.

- **12.3** Web-vitals reporting (D-055 partial):
  - `src/server/routes/vitals.ts`: `POST /api/vitals` — accepts `{ name, value, id, delta }`
    JSON body; rate-limited (60/min); logs or enqueues for future aggregation.
  - `render-page.tsx`: inject web-vitals attribution IIFE snippet in `shell()` when
    `WEB_VITALS_ENDPOINT` env var is set (after analytics tag; before `headExtra`).
  - Unit test: `shell()` includes snippet when env set; `POST /api/vitals` returns 204.

- **12.4** Sentry + Express error handler (D-055):
  - `src/server/sentry/index.ts`: `captureException(err, ctx?)` export with mode switch
    (`SENTRY_DSN` → real, `SENTRY_DISABLED=true` → no-op, else dev stub).
  - `src/server/app.ts`: add global 4-param Express error handler after all routes (JSON
    `{ error: … }` response, masks 500 bodies in production, logs full stack). Integrate
    Sentry `requestHandler` + `errorHandler` when DSN present.
  - `src/client/sentry/index.ts`: client-side `captureException` wrapper for Studio.
  - `src/admin/AdminApp.tsx`: wrap `<RouterProvider>` in `<SentryErrorBoundary>` with a
    simple `<ErrorFallback>` component (retry button, no Puck-specific path).
  - Tests: unit test for mode-switch; jsdom test for ErrorBoundary rendering fallback.

- **12.5** CSP hardening (D-056):
  - `src/server/csp.ts`: `buildCsp(env: NodeJS.ProcessEnv): Record<string, string[]>` —
    assembles directives from env vars (`ANALYTICS_BASE_URL`, `WEB_VITALS_ENDPOINT`,
    `SENTRY_DSN`, `CSP_CRM_EXTRA_ORIGINS`). Unit-tested.
  - `src/server/app.ts`: replace `helmet({ contentSecurityPolicy: false })` with
    `helmet({ contentSecurityPolicy: { directives: buildCsp(process.env) } })`.
  - Document `'unsafe-inline'` gap and nonce-per-request migration path in `docs/security.md`.

- **12.6** Rate-limit completion:
  - `POST …/ai-edit` — add `rateLimit({ max: 5, windowMs: 60_000 })` (AI calls are expensive).
  - `GET /api/sites/:id/crm/phone-numbers` (admin-crm proxy) — add
    `rateLimit({ max: 30, windowMs: 60_000 })`.
  - `POST /api/vitals` already rate-limited in 12.3.
  - Integration tests: verify 429 after rate-limit is hit on the AI edit endpoint.

- **12.7** pg-boss observability:
  - `GET /api/admin/jobs/health` (new route in `src/server/routes/admin-jobs.ts`): returns
    queue sizes + oldest pending job age for `MEDIA_PROCESS_UPLOAD`, `TEMPLATE_MATERIALIZE`,
    `CRM_SYNC_JOB`. `requireAdmin`. Uses `getBoss().getQueueSize(name)`.
  - Worker-restart resilience: if `bootJobs()` is called a second time after a crash, ensure
    idempotent re-registration (queue `createQueue` is already idempotent; verify `boss.work`
    call safety).
  - Integration test: health endpoint returns 200 with queue-size fields (boss disabled in
    test env → returns `{ enabled: false }`).

- **12.8** First real client migration runbook + smoke-test CLI:
  - `docs/migration.md`: step-by-step migration sequence — pre-flight (CTM account, CRM
    creds, analytics instance, GCS bucket), site provisioning (`provision-site.ts`), domain
    cutover (DNS + verify via admin domains tab), analytics enable, CTM account ID entry,
    smoke test (page renders, form submits via CRM embed, phone tracking swap), rollback plan.
  - `scripts/smoke-test.ts`: CLI that takes `--site-id=` and verifies: site resolves,
    primary domain SSL active, CTM script in HTML, analytics script in HTML (if env set),
    CRM provisioned (`crm_site_id` non-null). Exits 0 if all checks pass.
  - Final cold suite + typecheck green. Update `docs/data-model.md` with `analytics_disabled`.

---

## Operator prereqs (build proceeds without them; document in PR)

- **Plausible CE / Umami instance**: one Cloud Run service + small Postgres DB (or shared
  instance). Set `ANALYTICS_BASE_URL=https://analytics.anchorcorps.com` + `ANALYTICS_PROVIDER=plausible`
  (default) in Secret Manager on the `anchor-sites` Cloud Run service. Sites register automatically
  by domain — no per-site API call needed.
- **Sentry project** (optional): create project at sentry.io; set `SENTRY_DSN` in Secret Manager.
  Skip for self-hosted installs; set `SENTRY_DISABLED=true`.
- **`CRM_BASE_URL` + `CRM_API_KEY`** — already documented in P11 prereqs; set `CSP_CRM_EXTRA_ORIGINS`
  to the CRM's origin if it loads external scripts in the embed.
- **`WEB_VITALS_ENDPOINT`** — set to `/api/vitals` (relative, handled in-process) or an external
  RUM collector. Omit to disable web-vitals collection.
- **First client**: WordPress export in hand; DNS TTL lowered to 60s before cutover.
