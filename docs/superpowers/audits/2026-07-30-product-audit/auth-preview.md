# Big-Picture Audit — Slice: Authentication + Preview-Token Machinery

Date: 2026-07-30. Read-only audit; no code changed. Prod live-checked unauthenticated at
https://studio.anchorcorps.com.

## Headline: what prod's auth mode ACTUALLY is

**Prod is in `google` mode, live and working — the brief's premise that X-Admin-Token might
still be the only usable prod path is outdated.** Verified two ways:

1. Live: unauthenticated `POST https://studio.anchorcorps.com/api/auth/sign-in/social`
   (provider google) returns HTTP 200 with a real `accounts.google.com/o/oauth2/v2/auth` URL
   (client_id `333281424614-tt2…apps.googleusercontent.com`, redirect_uri
   `https://studio.anchorcorps.com/auth/google/callback`, PKCE S256). A disabled-mode
   deployment would have no handler mounted and this endpoint would not exist.
2. Code+deploy: `cloudbuild.yaml:145` wires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `BETTER_AUTH_SECRET` from Secret Manager on every deploy, and
   `resolveStudioAuthMode` (src/server/auth/studio-auth.ts:73) resolves all-three-present →
   `google`.

X-Admin-Token remains a live PARALLEL path (`ADMIN_API_TOKEN` also wired in cloudbuild;
`requireAdmin` accepts either, by design — documented break-glass, docs/studio-auth.md).

Other live observations (unauthenticated):
- `GET /login` → 200, serves the SPA shell. **Browser-tab title is `Site Template` with a
  lorem-ipsum meta description** (index.html:6) — see D806.
- The login page offers a "Sign in with Google" button (primary) plus a small
  "Use an admin token instead" link revealing a paste field (LoginPage.tsx) — both methods
  present; Google is visually primary.
- `GET /api/auth/get-session` → 200 `null` (no session). `GET /api/me` → 401
  `{"error":"unauthorized"}`.
- `GET /api/auth/error?error=access_denied` → **302 to `/?error=access_denied`** (feeds D800).
- Headers: full helmet set — CSP present (but `script-src 'unsafe-inline' … unpkg.com`,
  see D810), `strict-transport-security: max-age=15552000; includeSubDomains`,
  `x-frame-options: SAMEORIGIN`, `frame-ancestors 'self'`, `referrer-policy: no-referrer`,
  and `access-control-allow-origin: *` on everything (see D809).
- Curiosity outside this slice: `GET /healthz` on the studio hostname returns Google
  Frontend's own 404 page — the public routing layer doesn't map it (health checks
  presumably hit the Cloud Run URL directly). Not an auth defect; noted for the infra slice.

## Census (M = 28 units)

Modules (16):
- U1 `src/server/auth/studio-auth.ts` — mode switch, Better-auth factory, team gate
- U2 `src/server/auth/studio-auth-mount.ts` — host-gated mount + callback shim
- U3 `src/server/auth/tenant-auth.ts` — per-site tenant auth (site_id-scoped adapter)
- U4 `src/middleware/requireAdmin.ts` — dual-mode admin gate
- U5 `src/server/preview-token.ts` — HMAC preview tokens (mint/verify/previewQueryAuth)
- U6 `src/server/preview-links.ts` — preview-only href rewriting + query propagation
- U7 `src/server/preview-overlay.ts` — overlay bundle + CSP nonce + CSS
- U8 `src/server/routes/me.ts` — `GET /api/me` auth probe
- U9 `src/admin/auth/LoginPage.tsx` — sign-in UI (Google + token paste)
- U10 `src/admin/auth/RequireAdmin.tsx` + `useStudioSession.ts` — client route guard
- U11 `src/admin/lib/adminToken.ts` — localStorage legacy token store
- U12 `src/admin/lib/apiFetch.ts` + `agent-api.ts` (auth handling) — fetch wrappers
- U13 `src/admin/lib/session.ts` — fetchMe / signInWithGoogle / signOut
- U14 `src/admin/components/UserMenu.tsx` + `AdminLayout.tsx` — sign-out affordances
- U15 `src/admin/components/SitePreviewPanel.tsx` — client preview-token lifecycle
- U16 `src/server/routes/admin-pages.ts` — mint route + previewQueryAuth wiring + preview headers

Auth modes (4): U17 google · U18 dev · U19 disabled · U20 X-Admin-Token legacy

Flows / artifacts (8): U21 first sign-in · U22 sign-out · U23 session expiry mid-session ·
U24 admin-token 401 mid-session · U25 preview token mint/refresh/expiry · U26 rejected
non-team Google sign-in · U27 cookie artifacts (`studio.*` session cookies) · U28
localStorage artifact (`anchorcorps.admin_token`)

## Lenses (L = 19)

Term(inality), Struct(ure/Grain), Org(anization), Prov(enance→Consumption), Compr(ehension),
StVis (State-Visibility), Hon(esty), Rev(ersibility/Safety), Idem(potence/Accretion),
Fail(ure/Recovery), Precond (Precondition/Forward-path), Pop(ulation/Dark), Sib(ling-Coherence),
Gate (Gating-Axis), Temp(oral-Integrity), Cost(/Value), Contr(act-Stability),
Name (Naming/Least-astonishment), Sec(urity).

## Ledger — 28 × 19 = 532 cells (P = pass, Dxxx = directive, n = n/a; no blanks)

| Unit | Term | Struct | Org | Prov | Compr | StVis | Hon | Rev | Idem | Fail | Precond | Pop | Sib | Gate | Temp | Cost | Contr | Name | Sec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 studio-auth.ts | D805 | P | P | P | P | n | P | P | P | P | P | P | P | D804 | P | P | P | P | P |
| U2 studio-auth-mount.ts | n | P | P | P | P | n | P | P | P | P | P | P | P | P | n | P | P | P | P |
| U3 tenant-auth.ts | n | P | P | P | P | n | P | P | P | P | P | D812 | D812 | P | n | P | P | P | D812 |
| U4 requireAdmin.ts | P | P | P | P | P | n | D816 | P | P | P | P | P | P | P | n | D817 | P | P | D803 |
| U5 preview-token.ts | P | P | P | P | P | n | P | P | P | P | P | P | P | P | P | P | P | P | P |
| U6 preview-links.ts | n | P | P | P | P | n | P | P | P | P | P | P | P | n | P | P | P | P | P |
| U7 preview-overlay.ts | n | P | P | P | P | n | P | P | P | P | P | P | P | n | n | P | P | P | P |
| U8 me.ts | n | P | P | P | P | P | P | n | P | P | P | P | P | P | n | P | P | P | P |
| U9 LoginPage.tsx | n | P | P | P | D800 | P | P | P | P | P | D814 | P | P | P | n | P | P | D806 | P |
| U10 RequireAdmin.tsx/useStudioSession | n | P | P | D800 | P | P | P | P | P | D801 | P | P | P | P | n | P | P | P | P |
| U11 adminToken.ts | P | P | P | P | P | P | P | P | P | P | P | P | P | n | n | P | P | P | D810 |
| U12 apiFetch.ts/agent-api.ts | n | P | P | P | P | n | D802 | P | P | D801 | P | P | P | P | n | P | P | P | P |
| U13 session.ts | P | P | P | P | P | n | P | P | P | P | P | P | P | P | n | P | P | P | P |
| U14 UserMenu/AdminLayout | P | P | P | P | P | D813 | P | P | P | P | P | P | P | n | n | P | P | P | P |
| U15 SitePreviewPanel tokens | n | P | P | P | P | P | P | P | D815 | P | P | P | P | n | D807 | P | P | P | P |
| U16 mint route + previewQueryAuth | n | P | P | P | P | n | P | P | P | D808 | P | P | P | P | P | P | P | P | P |
| U17 google mode | D804 | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | D809 |
| U18 dev mode | n | P | P | P | P | P | P | P | P | P | P | P | P | P | n | P | P | P | P |
| U19 disabled mode | n | P | P | P | D814 | P | P | P | P | P | P | P | P | P | n | P | P | P | P |
| U20 X-Admin-Token mode | P | P | P | D811 | P | P | P | P | P | P | P | P | P | P | n | P | P | P | D810 |
| U21 first sign-in flow | n | P | P | P | P | P | P | P | P | P | P | P | P | P | n | P | P | P | P |
| U22 sign-out flow | P | P | P | P | P | P | P | P | P | P | P | P | P | n | P | P | P | P | P |
| U23 session expiry mid-session | P | n | n | P | P | D801 | P | P | P | D801 | P | P | P | n | P | P | P | P | P |
| U24 token 401 mid-session | P | n | n | P | P | P | P | P | P | P | P | P | P | n | n | P | P | P | P |
| U25 preview mint/refresh/expiry | P | P | P | P | P | P | P | P | D815 | D808 | P | P | P | P | D807 | P | P | P | P |
| U26 rejected Google sign-in | n | n | n | D800 | D800 | P | P | P | P | D800 | P | P | P | P | n | P | P | P | P |
| U27 cookie artifacts | P | P | P | P | P | n | P | P | P | P | P | P | P | n | P | P | P | P | P |
| U28 localStorage artifact | P | P | P | P | P | P | P | P | P | P | P | P | P | n | n | P | P | P | D810 |

Blank cells: 0.

### Notes behind selected passes

- U5 Terminality P-with-note: preview tokens are unrevocable by construction (stateless HMAC),
  including surviving sign-out for ≤15 min — an explicit, documented tradeoff
  (preview-token.ts:39-43). Accepted, not a directive.
- U5 Sec P: constant-time verify with length guard (preview-token.ts:139-145), derived key
  (fixed label, never Better-auth's raw signing use), sig-before-scope ordering, `.`-in-siteId
  guard, fail-closed with no secret. This module is the slice's quality bar.
- U18 dev-mode Gate P: the auto-grant requires `dev` mode AND no `ADMIN_API_TOKEN`
  (requireAdmin.ts:85), so integration tests that set the token still enforce 401s, and prod
  (`NODE_ENV=production`) can never auto-grant.
- U16 Precond P: mint route 404s for unknown sites and 503s ("preview tokens not
  configured") when no signing secret exists — fails loudly rather than minting garbage
  (admin-pages.ts:293-307).
- U22 sign-out P: `signOut()` (session.ts:40) revokes the server session AND clears the
  localStorage token; both affordances (UserMenu.tsx:50, AdminLayout.tsx:23) then hard-navigate
  to /login. Terminality of the CURRENT session is correct; other sessions → D805.
- U27 cookies P: Better-auth defaults — httpOnly, host-only (no Domain attr, deliberate
  D-032 boundary), `studio.` prefix, Secure under the https baseURL, SameSite=Lax (which is
  also the working CSRF defense for the cookie path; admin mutations are POST/PUT/DELETE).
- U6 Sec P: protocol-relative `//` guard and attribute escaping in the href rewriter are
  both present (preview-links.ts:120-125); `edit`/`bridge` params deliberately not propagated.
- U24 P: both fetch wrappers clear the stored token on 401 (apiFetch.ts:45-48,
  agent-api.ts "Item 7") — the legacy-token operator gets bounced on their next remount.

## Directives (N = 18, D800–D817) — severity-ordered

[D800] (U26 rejected non-team Google sign-in) × (Comprehension) — «Every auth rejection must land the user on a screen that says what happened». Instance: Better-auth 302s the rejected callback to `/?error=…` (verified live: `/api/auth/error?error=access_denied` → 302 `/?error=access_denied`); `/` is behind RequireAdmin, whose redirect keeps only `location.pathname` (RequireAdmin.tsx:23) — the `?error` query is dropped and LoginPage.tsx never reads any error param, so a rejected teammate lands on a pristine login page with zero explanation and will loop. Fix-class: preserve `location.search` in the guard's redirect state and render a human message for known `?error=` values on LoginPage.

[D801] (U23 session expiry mid-session) × (Failure/Recovery) — «An expired session must produce a visible re-auth path that does not cost unsaved work». Instance: `useStudioSession` probes `/api/me` exactly once on mount (useStudioSession.ts:14); when the Google session lapses mid-use nothing re-runs the guard, `apiFetch` just throws 401s into each caller, and an operator mid-inline-edit sees only the amber "Save failed — will retry on next edit" chip (SitePreviewPanel.tsx:372) while every retry 401s — no bounce, no re-auth prompt, edits stranded in the iframe. Fix-class: a shared 401 event from apiFetch that flips a "session expired — sign in again" modal (preserving SPA state) or forces the guard to re-probe.

[D804] (U1 studio-auth.ts team gate) × (Gating-Axis/Terminality) — «An allowlist must be enforced at every sign-in, not only at account creation». Instance: `isAllowedStudioEmail` is wired ONLY into `databaseHooks.user.create.before` (studio-auth.ts:161-175), so it never re-fires for an existing `auth_user`; removing an `ADMIN_ALLOWED_EMAILS` entry (e.g. an offboarded non-Workspace contractor) or shrinking `STUDIO_ALLOWED_DOMAIN` does not stop that account's future Google sign-ins, and no admin surface exists to delete `auth_user`/`auth_session` rows. Fix-class: also enforce the gate on session creation (sign-in hook), so revocation = editing the env allowlist.

[D810] (U11/U20/U28 admin token in localStorage) × (Security) — «A long-lived admin credential must not sit in localStorage under a CSP that permits inline scripts». Instance: `anchorcorps.admin_token` in localStorage (adminToken.ts:9) combined with `script-src 'unsafe-inline' … unpkg.com` served live on the Studio origin (csp.ts:30-36, verified in prod headers) means any XSS or a compromised unpkg fetch exfiltrates the static `ADMIN_API_TOKEN`; the localStorage posture is a known deferred item, but the CSP that would mitigate it is weak at the same time. Fix-class: ship the already-documented nonce-CSP migration (csp.ts:7-9) for the Studio host and drop unpkg from script-src there; longer term retire the paste-token from the SPA (keep X-Admin-Token for curl/CI only).

[D807] (U25 preview refresh) × (Temporal-Integrity) — «A credential refresh must never navigate the surface the user is looking at». Instance: the re-mint timer fires at 80% of the 15-min TTL (~12 min, SitePreviewPanel.tsx:21-25) and the adopt effect writes the new token into `src` (SitePreviewPanel.tsx:188-191), which navigates the iframe — the operator's preview reloads every 12 minutes, losing scroll position (the known reported issue; edit mode is already exempt, plain browsing is not). Fix-class: hold refreshed tokens in `previewToken` only and embed them on the next intentional navigation (nonce/page change), accepting that an idle frame keeps its already-loaded document; or lengthen the TTL and refresh only when a navigation is imminent.

[D803] (U4 requireAdmin.ts) × (Security) — «Compare secrets in constant time everywhere, not just in the new code». Instance: `req.header("x-admin-token") === expected` (requireAdmin.ts:79) is a variable-time string compare of the long-lived admin token, in the same codebase whose preview-token verify carefully uses length-guarded `timingSafeEqual` (preview-token.ts:139-145) and cites git-webhook.ts as the pattern. Fix-class: buffer both values and use the same length-guarded `timingSafeEqual` shape.

[D812] (U3 tenant-auth.ts) × (Population/Dark, Security) — «Dark modules must not carry hardcoded fallback secrets into production reach». Instance: `getTenantAuth` has zero production consumers (only tests/integration/tenant-auth.test.ts; never mounted — `/api/auth/*` on tenant hosts falls through to nothing) while its 4 `tenant_auth_*` tables exist (db/migrations/1747578000000_tenant_auth.cjs), and `tenantSecret()` silently falls back to the committed constant `"dev-tenant-auth-secret-please-set-in-prod"` (tenant-auth.ts:40) — if it is ever mounted with a missing env, real tenant sessions get signed with a public string. Fix-class: throw when `NODE_ENV==="production"` and `BETTER_AUTH_SECRET` is unset; mark the module's unmounted status at its top.

[D805] (U1/U17 sessions) × (Terminality) — «Sessions must be enumerable, revocable in bulk, and pruned». Instance: sign-out revokes only the current session; there is no "sign out everywhere"/session list (Better-auth supports revoke-all but nothing calls it), and no job prunes expired `auth_session`/`auth_verification` rows (no DELETE anywhere in src/server; migration 1747577000000_auth_studio.cjs creates the tables with no TTL story) — abandoned-session and abandoned-OAuth-state rows accrete forever. Fix-class: a small scheduled prune (`DELETE … WHERE "expiresAt" < now()`) plus a revoke-all option on the account menu.

[D808] (U16/U25 expired preview token) × (Failure/Recovery) — «An expired credential inside an iframe must render a human recovery page, not raw JSON». Instance: after 15 min, a click on a rewritten sibling link (which carries the ORIGINAL `?token=` — preview-links.ts propagates the query it was rendered with) 401s and the frame displays `{"error":"unauthorized"}` with no way back (requireAdmin.ts:91 via admin-pages.ts:335); the parent can't detect it either (opaque origin, SitePreviewPanel.tsx:136-139). Fix-class: on preview-route 401 for an HTML-accepting request, serve a tiny "Preview expired — reload the workspace" page instead of JSON.

[D806] (U9 login page) × (Naming/Least-astonishment) — «The admin product must not introduce itself as a template». Instance: the live Studio login tab reads `Site Template` with description "Lorem ipsum dolor sit amet…" (index.html:6, verified in prod response body) — the shared SPA shell's placeholder metadata is the first thing a first-time teammate sees. Fix-class: set real title/description in index.html (or swap them client-side for the admin host, which already knows `isAdminHost`).

[D809] (U17 app-wide CORS) × (Security) — «An admin-only API should not advertise `Access-Control-Allow-Origin: *`». Instance: `app.use(cors())` with defaults (src/server/app.ts:51) stamps `*` on every response including `/api/auth/*` and reflects preflight headers; cookies are protected (credentialed requests can't use `*`) but it needlessly permits any origin to read unauthenticated endpoints and green-lights custom-header preflights. Fix-class: scope cors() to the routes that need it (tenant/public), or allowlist the studio origin.

[D813] (U14 UserMenu) × (State-Visibility) — «Show me who I am». Instance: `/api/me` returns id/email/name and `useStudioSession` exposes `user`, but UserMenu.tsx renders only a generic `UserIcon` and no consumer anywhere displays the signed-in identity (grep: `user` from useStudioSession is dropped by RequireAdmin.tsx too) — the known "generic avatar, no identity" gap, confirmed end-to-end: identity is fetched, then discarded. Fix-class: thread `useStudioSession().user` into UserMenu (avatar initial + email row in the dropdown).

[D814] (U9/U19 login vs auth mode) × (Precondition/Forward-path) — «Offer only sign-in methods the deployment can honor». Instance: LoginPage renders the Google button unconditionally; in a `disabled`/`dev` deployment it fails post-click with "Could not start Google sign-in. Is OAuth configured?" (session.ts:34) — jargon for a teammate, and nothing tells the client which mode is active (no discovery endpoint; /api/me only says 401). Fix-class: tiny unauthenticated mode-discovery response (e.g. `/api/auth-mode` or a flag on the 401 body) that LoginPage uses to pick which method to present.

[D802] (U12 apiFetch.ts) × (Honesty) — «Comments must describe what the code does». Instance: apiFetch.ts:24 claims clearing the token on 401 makes "the guard bounce to /login" — the guard (`useStudioSession`) neither subscribes to token changes nor re-probes, so no bounce occurs within a mounted SPA (only on the next full remount); for Google-session operators there is no token to clear at all. Fix-class: fix the comment when D801's real 401 handler lands (same change).

[D816] (U4 requireAdmin.ts) × (Honesty) — «Do not swallow auth-infrastructure failures silently». Instance: the session check's `catch {}` (requireAdmin.ts:72-74) drops every `getSession` error — a broken DB or misconfigured Better-auth degrades all Google operators to 401 with zero log evidence of why. Fix-class: log the error (once per burst / debug level) before falling through.

[D815] (U15/U25 mint retry) × (Idempotence/Accretion) — «A background retry loop must have a terminal state». Instance: a failed mint reschedules every 20 s forever (SitePreviewPanel.tsx:172) — after a session lapse this hammers `/api/sites/:id/preview-token` with 401s indefinitely (each also re-clearing the already-cleared token) for as long as the tab is open. Fix-class: cap retries or back off exponentially; stop entirely once D801's re-auth prompt is showing.

[D811] (U20 legacy query token) × (Provenance/Security) — «Credentials must not land in request logs». Instance: pino-http logs full `req.url`, and the legacy path still lifts `?token=<ADMIN_API_TOKEN>` into the header for preview/curl flows (tokenFromQuery, admin-ai-agent.ts:67-72) — the long-lived token appears verbatim in Cloud Run logs (known deferred item; the pv1 token in URLs is 15-min/site-scoped by design and acceptable). Fix-class: pino redact/serializer that strips `token` from logged URLs; keep discouraging the raw admin token in queries.

[D817] (U4 requireAdmin.ts) × (Cost/Value) — «Don't pay a DB round-trip per request for a verifiable cookie». Instance: every admin API call does a `getSession` DB lookup (requireAdmin.ts:63) — Better-auth's `session.cookieCache` (signed short-lived cookie) is not enabled, so the busiest surface (workspace polling, SSE setup, autosaves) serializes on `auth_session` selects. Fix-class: enable cookieCache with a small maxAge (e.g. 60 s); revocation latency tradeoff is acceptable for an internal tool.

## Coverage statement

Census M = 28 units; Lenses L = 19; Cells = 532, 100% filled (0 blank).
Directives N = 18 (D800–D817). Passes P = 438. n/a Q = 60. Directive-bearing cells = 34
(several directives span multiple cells).

## Brief-premise corrections (per operator's verify-don't-ask rule)

1. "Is X-Admin-Token still the ONLY usable prod path?" — **No. Google OAuth is live in prod**
   (see Headline). The dual-mode token path also still works, as designed.
2. The brief's known items all confirmed real: generic avatar/no identity (D813), 12-min
   iframe reload (D807 — it is the token-refresh adoption at 80% of the 15-min TTL, exactly
   12 min), token-in-logged-URLs deferred item (D811).
3. `src/server/routes/me.ts` exists as censused; `preview-token.ts`/`preview-links.ts`/
   `preview-overlay.ts` live in `src/server/` (not `src/server/routes/`); the requireAdmin
   middleware the census implies lives at `src/middleware/requireAdmin.ts`.
