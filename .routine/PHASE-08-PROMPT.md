# Kickoff prompt — Phase 8 (auth: studio login + per-site copy-in)

> Paste the block below to run Phase 8. **Ordering note:** PLAN.md lists
> **Phase 7.5 (plugin framework) BEFORE Phase 8.** Only run this once 7.5 is
> complete, or when the operator deliberately defers 7.5. The prompt has the
> agent read STATE.json for the *actual* current phase + the previous phase's
> baseline and honor the phase gate, so it won't run out of order on its own.
> Update the date when you run it.
>
> **HARD OPERATOR PREREQUISITE (do this before the studio-login part can go
> live):** create a Google OAuth Client ID — Console → APIs & Services →
> Credentials → Web application; authorized redirect URI
> `https://studio.anchorcorps.com/auth/google/callback`; consent screen
> Internal. Put the Client ID + secret in Secret Manager (project
> `anchor-hub-480305`). This CANNOT be done via CLI. Until it's set, studio
> OAuth is built + tested locally/mocked but prod stays on the interim token.

---

Continue the AnchorCorps Site Builder routine. Working directory:
  /Volumes/G-DRIVE SSD/DEVELOPER/anchor-sites

Run as autonomously as possible: after the Phase 8 task list is confirmed (see
"Phase start"), work straight through task-by-task without per-task
confirmation. Only stop for (a) a true blocker, (b) the Phase 8→9 boundary, or
(c) context/usage limits. Surface milestones and blockers in chat — do NOT
email.

Read first, in order:
  1. ROUTINE-README.md + .routine/DAILY-PROMPT.md (work loop + hard rules)
  2. .routine/STATE.json — the AUTHORITATIVE current state. Confirm what the
     last completed phase actually was (Phase 7, or 7.5 if it ran), read the
     recorded baseline (`tests.current_pass` + file count), and read
     open_followups, especially: (i) the Google OAuth Client ID prereq for
     studio login (below); (ii) ANTHROPIC_API_KEY still unprovisioned (prod AI
     = stub); (iii) the compromised-keys rotation (SECURITY entry); (iv) the
     test-isolation-hardening follow-up (warm-cache flake; cold/CI green);
     (v) run `npm run db:seed-templates` on prod if not yet done.
  3. PLAN.md (you are doing Phase 8 — "Auth/blog/events copy-in pattern for
     provisioned sites", which per the plan note ALSO builds the studio
     control-hub login).
  4. DECISIONS.md — especially:
     - **D-034** (studio control-hub auth = Google OAuth via Better-auth, built
       in Phase 8: app-level OAuth scoped to the studio host only — NOT IAP,
       because the service also serves public tenant sites; team-gated
       (Workspace `hd == anchorcorps.com` + optional `ADMIN_ALLOWED_EMAILS`
       allowlist); local = no auth (auto-granted dev session); httpOnly
       host-only session cookie on studio.anchorcorps.com; `requireAdmin` flips
       from X-Admin-Token check → session check; the token is retired or kept
       only as a documented CI/service path).
     - **D-020** (Better-auth is the auth library — sessions, hashing, email
       verification, password reset, OAuth, optional 2FA; works with `pg`;
       ships its own schema/migrations).
     - **D-008** (auth/blog/events are COPIED per-site, editable per-client, not
       centralized) — and RECONCILE it with **D-003** (one multi-tenant
       renderer by Host header, not per-site deploys). These pull in different
       directions; resolving "what 'per-site copy' means under one shared
       renderer" is the central design fork of this phase — raise it in the
       EXPAND gate, don't guess.
     - D-032 (studio host boundary — why the cookie is host-only there),
       D-002/D-001 (block/registry contracts), D-024 (anchor-hub project +
       Cloud SQL anchor_sites_prod), D-035 (CI auto-deploys prod on push),
       D-025 (domains), D-026 (npm-workspace monorepo).
  5. docs/admin-ui.md (the interim X-Admin-Token + the D-034 Phase-8 hand-off),
     docs/data-model.md (auth_* are RESERVED future tables — Better-auth ships
     them this phase), docs/provisioning.md (how sites get created — the
     copy-in attaches here), docs/templates.md.

Phase 8 is NOT pre-drafted. So:
  - Confirm .routine/NEXT-PHASE-APPROVED exists. If ABSENT, STOP (hard rule #1)
    — UNLESS the operator gives explicit in-chat go-ahead, which satisfies the
    gate (create then consume the file yourself; don't bounce it back).
  - On go: delete it, then run a full EXPAND + CONFIRM gate. Phase 8 has TWO
    fairly independent deliverables — propose them as clearly separable tracks
    and let the operator choose ordering/scope:
      A. **Studio control-hub login (D-034)** — Better-auth Google provider on
         the studio host; team-gating; host-only session cookie; local no-auth
         dev session; flip `requireAdmin` token→session (keep the token path
         only if a concrete CI/service need exists); Better-auth schema
         migration into anchor_sites_prod. This retires the interim token and
         is the higher-immediate-value track — likely do it first. Live cutover
         is gated on the operator's Google OAuth Client ID prereq (above);
         build + jsdom/supertest test with the OAuth round-trip mocked, keep
         prod on the token until the secret lands.
      B. **Per-site auth/blog/events copy-in (D-008/D-020)** — define, WITH the
         operator, how auth/blog/events attach to a provisioned site under the
         single shared renderer (D-003): per-`site_id` Better-auth config +
         tables, blog/events data scoped by site_id, what "copy-in / editable
         per-client" means in practice (template/config vs forked code), and
         the migrations. This is the larger, more architectural track.
    Present the task list (PHASE-08-*.md) for sign-off BEFORE writing code.
    Then set STATE current_phase=8 / current_phase_file=PHASE-08-*.md /
    current_task=8.1 and begin.

Pre-flight before any code:
  - docker compose up -d postgres        (host port 5434)
  - export DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev \
           TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test
  - Baseline: `npm test` must equal the count recorded in STATE.json /
    .routine/baseline-tests.log at the PREVIOUS phase close (451 across 66 files
    if Phase 7 was last; higher if 7.5 ran — read STATE for the authoritative
    number; never push if the baseline regressed). WARM-CACHE FLAKE: if a
    non-resolveSite integration test fails, RE-RUN COLD first
    (`rm -rf node_modules/.vite/vitest` then `npm test`); only halt if it fails
    cold too.

Execution rules:
  - One commit per phase-MD sub-checkbox (conventional, reference P8-T8.x). Tick
    the checkbox + append the PHASE-08 completion log + update STATE after each,
    incl. the tiny "chore(routine): record sha …" follow-up.
  - CI is live (D-035): every push to main auto build→migrate→deploys PROD.
    typecheck + full COLD suite GREEN before every push; confirm with the
    operator before the phase's first prod-deploying push (this phase ships an
    auth migration + an auth gate — be especially careful: a broken
    `requireAdmin` could lock the operator out of studio, and the OAuth cutover
    must not 401 the whole admin surface in prod before the secret is live).
  - Use the Read TOOL before any Edit on STATE.json / PHASE-08 / DECISIONS /
    PLAN, and re-grep to confirm edits land.
  - NO browser automation on this machine (hard rule). Test server/auth logic
    with supertest + the OAuth provider + Better-auth session MOCKED; test
    Studio UI in jsdom with Puck STUBBED (D-036) + fetch mocked. Don't claim
    visual success — leave the real Google sign-in QA for the operator at
    studio.anchorcorps.com once the Client ID is provisioned.
  - Every new table: forward + rollback migration (node-pg-migrate). Background
    work uses pg-boss (D-019). Cross-service calls idempotent.
  - SECRETS: the Google OAuth client secret + any session secret go in Secret
    Manager and are wired via Cloud Run --set-secrets — NEVER commit them
    (hard rule #8). If you need a new secret, that's an operator prereq; raise
    it, don't guess a value.
  - Record any new dependency / API-shape / data-model decision as a new D-0xx.
  - Don't auto-advance past the Phase 8→9 boundary (Phase 9 = SEO layer).

Where we are: read STATE.json for the exact current phase + baseline. As of the
Phase 7 close: template system live in prod (CI deploy), 451 tests/66 files
cold-green, studio still on the interim X-Admin-Token (D-034), live AI gated on
ANTHROPIC_API_KEY (prod = stub). Phase 8 builds the real studio login + the
per-site auth/blog/events pattern.

I'm here in chat. Begin by confirming the gate (and whether Phase 7.5 ran or is
being deferred), then propose the Phase 8 task list for my sign-off.
