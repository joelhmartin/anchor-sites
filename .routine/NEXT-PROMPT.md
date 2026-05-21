# Next-agent kickoff prompt — Phase 7.5 (plugin / integration framework)

> Paste the block below to start the next routine run. Phase 7 (template
> system) is COMPLETE and pushed (CI deploying). The next phase is **7.5**,
> the plugin/integration framework (D-016) — a SEPARATE phase from the Phase 7
> templates work and from the concrete plugins (Stripe etc.) that come AFTER
> 7.5 as packages. Update the date if you run it on a different day.

---

Continue the AnchorCorps Site Builder routine. Working directory:
  /Volumes/G-DRIVE SSD/DEVELOPER/anchor-sites

Run as autonomously as possible: after the Phase 7.5 task list is confirmed
(see "Phase start"), work straight through task-by-task without per-task
confirmation. Only stop for (a) a true blocker, (b) the Phase 7.5→8 boundary,
or (c) context/usage limits. Surface milestones and blockers in chat — do NOT
email.

Read first, in order:
  1. ROUTINE-README.md + .routine/DAILY-PROMPT.md (work loop + hard rules)
  2. .routine/STATE.json (current state + open_followups — note "PHASE 7
     COMPLETE", that it's PUSHED/CI-deploying, current_task=null, and these
     OPEN items: (i) run `npm run db:seed-templates` against PROD for the
     Starter template — CI doesn't auto-seed; (ii) the test-isolation-hardening
     follow-up (warm-cache single-fork ordering flake — cold/CI is green);
     (iii) ANTHROPIC_API_KEY still unprovisioned so prod AI = stub; (iv) the
     compromised-keys rotation from the SECURITY entry)
  3. PLAN.md (Phases 1–7 ticked; you are doing Phase 7.5 — "Plugin /
     integration framework")
  4. DECISIONS.md — especially **D-016** (THE Phase-7.5 spec: manifest
     contract, `site_plugins` table, plugin loader, admin enable/disable, KMS-
     encrypted per-site config, migration ordering, renderer boot composition,
     and the runtime `registerBlock()` API reserved back in Phase 1). Also
     D-005 (versioned packages on GCP Artifact Registry), D-026 (npm-workspace
     monorepo — `packages/`), D-027/D-028 (tsup + prebuilt CSS for packages),
     D-002 (Zod registry + `registerBlock`), D-019/D-030 (pg-boss boot),
     D-024 (anchor-hub GCP project + Cloud SQL), D-035 (CI auto-deploys prod on
     every push to main). NOTE: concrete plugins (Stripe, PayPal, booking) are
     POST-7.5 package work, NOT this phase — 7.5 is just the framework.
  5. docs/data-model.md (note `site_plugins` is a RESERVED future table — you
     create it this phase), docs/templates.md, docs/admin-ui.md (the Studio you
     extend), docs/visual-editor.md, docs/ai-editing.md.

Phase 7.5 is NOT pre-drafted. So:
  - Confirm .routine/NEXT-PHASE-APPROVED exists. If ABSENT, STOP (hard rule #1)
    — UNLESS the operator gives explicit in-chat go-ahead, which satisfies the
    phase gate (create then consume the file yourself; don't bounce it back).
  - On go: delete it, then run a full EXPAND + CONFIRM gate — draft
    PHASE-07.5-plugins.md (a detailed task list covering, per D-016: the
    `site_plugins` table + migration; the `manifest.ts` plugin contract
    (blocks, routes, migrations, config schema, required env); the plugin
    loader that composes enabled plugins at renderer boot (mount routers at
    /api/plugins/<name>, register blocks via the existing `registerBlock`
    runtime API, verify the plugin's migrations ran); per-site config storage
    with KMS-encrypted secrets (D-016); admin enable/disable + config UI in
    Studio (reuse the Phase-5 editor for config where it fits); and how a
    plugin is packaged/distributed on Artifact Registry like
    `@anchorcorps/components`). Present that task list to the operator for
    sign-off BEFORE writing code. Then set STATE current_phase=7.5 /
    current_phase_file=PHASE-07.5-plugins.md / current_task=7.5.1 and begin.
  - Consider whether to do the test-isolation-hardening follow-up FIRST (split
    node vs jsdom vitest projects, or drop singleFork) — the flake surface grew
    in Phase 7. It's optional and non-blocking (cold/CI deterministic), but
    7.5 adds more DB-touching tests.

Pre-flight before any code:
  - docker compose up -d postgres        (host port 5434)
  - export DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev \
           TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test
  - Baseline: `npm test` must be **451 passing across 66 files** (Phase 7
    close). WARM-CACHE FLAKE: the single-fork/shared-DB ordering flake
    (FLAKE-RESOLVESITE class) can transiently fail `resolveSite.test.ts >
    /healthz` (403) OR a `templates-api` assertion under a warm local cache;
    cold cache (= CI) is deterministically green. If a non-resolveSite
    integration test fails, RE-RUN COLD first:
    `rm -rf node_modules/.vite/vitest` then `npm test`. Only halt if it fails
    cold too.

Execution rules:
  - One commit per phase-MD sub-checkbox (conventional commits, reference
    P7.5-T7.5.x). Tick the checkbox + append the PHASE-07.5 completion log +
    update STATE after each (same cadence as Phases 5/6/7, incl. the tiny
    "chore(routine): record sha …" follow-up so STATE.last_commit_sha + the
    log's Commit: stay accurate).
  - CRITICAL — CI is live (D-035): every push to main auto build→migrate→
    deploys PROD. typecheck + full COLD suite GREEN before every push; never
    push red. Pushing green to main IS the deploy. Confirm with the operator
    before the phase's first prod-deploying push.
  - Use the Read TOOL (not cat/tail) immediately before any Edit on
    STATE.json / PHASE-07.5 / DECISIONS / PLAN, and re-grep to confirm
    checkbox/log edits land.
  - NO browser automation on this machine (hard rule). Test server logic with
    supertest + mocked externals; test Studio UI in jsdom with Puck STUBBED
    (vi.mock the editor barrel — D-036) + fetch mocked. Don't claim visual
    success — leave UI QA for the operator at studio.localhost:3000.
  - Every new table gets a forward + rollback migration (node-pg-migrate).
    Plugin tables are plugin-owned/prefixed and must NOT alter core tables
    (D-016). Background work uses pg-boss (D-019). New cross-service calls
    idempotent. Secrets go in Secret Manager / KMS — never commit them
    (hard rule #8).
  - Record any new dependency / API-shape / data-model decision as a new D-0xx.
  - Don't auto-advance past the Phase 7.5→8 boundary.

Where we are: Phase 7 (template system) is COMPLETE and pushed to main
2026-05-21 (85a2848..1568865) — CI trigger anchor-sites-main building→migrate→
deploy to prod. 451 tests/66 files cold-green. The template layer is live:
save-as-template (site + page), templates admin API, create-site-from-template
via the idempotent `template.materialize` pg-boss job, page-from-template, the
Starter seed, and the Studio UI. OPERATOR PREREQ before the templates picker
works in prod: run `npm run db:seed-templates` against prod. ANTHROPIC_API_KEY
is still unprovisioned (prod AI = stub). Phase 7.5 (plugin framework, D-016) is
the NEXT phase; concrete plugins are post-7.5.

I'm here in chat. Begin by confirming the gate, then propose the Phase 7.5 task
list for my sign-off.
