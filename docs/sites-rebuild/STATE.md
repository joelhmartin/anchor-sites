# Anchor Sites Build — STATE (A/B routines)

**Read this FIRST every session / routine run.** Durable tracker for the autonomous
completion of the remaining anchor-sites phases (10→12). Conversation memory does not
survive across runs — this file + `git log` + open PRs are the source of truth. Mirrors
the anchor-operations `ops-rebuild` A/B system.

- **Master phase list:** `PLAN.md` (phases 1–9 complete & deployed; 10–12 remain).
- **Per-phase plans:** `docs/sites-rebuild/plans/2026-06-28-pN-*.md`
- **Legacy single-routine tracker:** `.routine/STATE.json` (history of phases 1–9; not used by A/B).
- **Autonomous routines:** `sites-rebuild-A` (BUILD) + `sites-rebuild-B` (REVIEW/MERGE + prep next phase).

These remaining phases are **pre-approved for autonomous A/B completion** (operator directive
2026-06-28: "just move forward", no per-phase confirmation gate). The old hard-rule-#1
`NEXT-PHASE-APPROVED` gate does NOT apply to the A/B system — readiness is tracked by phase
status in this file instead.

---

## Operating model — TWO offset routines (A builds, B reviews/merges + preps next)

Two cloud routines, every 4 hours, offset by 2 hours. Anchor-sites runs at HALF the cadence
of anchor-operations and on opposite (odd) UTC hours so two heavy builds never collide and
total fleet token usage stays bounded.

- **Routine A — BUILD** (`sites-rebuild-A`, id `trig_01DZT2rcE4cYDsfZUzvhcGgb`, cron `17 1-23/4 * * *` → 01:17/05:17/09:17/13:17/17:17/21:17 UTC):
  builds the first `ready` phase → opens a PR (CodeRabbit auto-reviews it). Never reviews or merges.
- **Routine B — REVIEW/MERGE + PREP** (`sites-rebuild-B`, id `trig_01ELQjhHMMfMcjaXc1pcUsDP`, cron `17 3-23/4 * * *` → 03:17/07:17/11:17/15:17/19:17/23:17 UTC, 2h after each A):
  reviews the open PR, folds in valid CodeRabbit comments + its own independent review, fixes
  defects, merges if green → marks the phase `complete`. **Then, as wrap-up, prepares the NEXT
  phase**: if the next phase is `pending-plan`, it scopes it (research the codebase, write the
  plan doc, no human gate) and flips it to `ready`. Never builds a phase itself.

Steady-state timeline: `A builds Pn → (2h) → B reviews+merges Pn AND preps Pn+1 → (2h) → A builds Pn+1 → …`

**Routine A (BUILD) each run:**
1. `git checkout main && git pull`; read this file + the phase's plan doc; best-effort env setup
   (`npm install`; provision Postgres on port 5434 — `docker compose up -d postgres`, else any
   local Postgres + `npm run migrate:up`; confirm `gh auth status`).
2. GUARD — if ANY phase is `in_review` or `blocked`, the reviewer hasn't merged yet (or a phase
   needs a human): append a run-log line and STOP. **Never build ahead of a merge.**
3. Else pick the first `ready` phase. Idempotency: if its branch/PR already exists, set it
   `in_review` and STOP. Otherwise branch `feat/sites-pN-<slug>` off main, re-read the plan
   against current code (adapt the plan doc if drifted), implement task-by-task with per-subitem
   commits (operator cadence) + TDD, ensure the full suite + typecheck are green (see "green"
   below), open a PR (do NOT merge), set the phase `in_review` with branch+PR#, commit+push this file.

**Routine B (REVIEW/MERGE + PREP) each run:**
1. Same orient + env setup.
2. Find the phase that is `in_review`. None → skip to step 7 (prep) so an idle B still advances readiness.
3. Check out its branch. Read the PR's existing review comments INCLUDING CodeRabbit:
   `gh pr view <n> --comments` + `gh api repos/<owner>/<repo>/pulls/<n>/comments` for inline. Triage
   each — fix valid points, note false positives. Independently review the diff vs the plan.
   - CodeRabbit on this repo is frequently **rate-limited** (org credit limit). It is **additive** —
     your own independent review is the gate. If CodeRabbit hasn't posted (or shows "Review limit
     reached"), do NOT block or wait: proceed on your own review.
4. Fix all real defects on the branch; re-run the full suite + typecheck until green.
5. Green + clean → `gh pr merge --squash --delete-branch`; set the phase `complete` (record merge
   commit + which CodeRabbit items were addressed); also append a deploy note once CI lands.
6. Unfixable this run → set the phase `blocked` with notes, leave the PR open, STOP (skip prep).
7. **Prep wrap-up** — prep ONLY when, after the review, NO phase is `ready` and NONE is `in_review`
   but a `pending-plan` phase remains (so A always has exactly one `ready` phase and B never preps
   ahead of an unbuilt phase). Take the first `pending-plan` phase: scope it (read PLAN.md +
   relevant code/docs, derive the task list like the Phase-10 prep), write
   `docs/sites-rebuild/plans/2026-06-28-pN-<slug>.md`, record any design decisions (next free
   D-number after D-049), flip the phase `pending-plan → ready`, commit+push this file + the plan.
   NO human confirmation gate (operator pre-approved autonomous completion). If a `ready`/`in_review`
   phase already exists, nothing to prep.

### Hard safety rules (non-negotiable)
- Never merge with red tests (B only).
- Routine A never builds while any phase is `in_review` or `blocked`. Routine B never builds a phase
  (it only reviews/merges + writes the NEXT plan doc).
- All implementation lands via branches + PRs (every change is revertible).
- Per run: A does at most 1 build; B does at most 1 review+merge (+1 plan prep).
- Routine B must resolve every CodeRabbit comment — fix it or record why it's a false positive.
- A merge to `main` auto-deploys prod (CI trigger `anchor-sites-main`: build → migrate → deploy).
  So **main must always be green**, and any phase shipping migrations is fine (they run in the CI
  migrate step before the image deploys). `requireAdmin` must stay dual-mode (no studio lockout).
- The human may review, comment on, override, or merge/close any PR at any time.

### Test environment note
- Tests need Postgres on host port **5434**: `docker compose up -d postgres` brings up
  `anchor-sites-postgres-1` (Docker Desktop). Then run with
  `DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_dev`
  `TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test npm test` and `npm run typecheck`.
- If Docker is unavailable in the routine env, provision any local Postgres on 5434 with role/db
  `anchor`/`anchor_dev`+`anchor_test` and `npm run migrate:up`. Pure-logic + jsdom tests run without DB.
- Migrations: verify up/down/up for any new migration before opening the PR.

### Definition of "green" (IMPORTANT — known warm-cache flake)
- "Green" = a **cold** full-suite run passes (`rm -rf node_modules/.vite node_modules/.vitest` then
  `npm test`) with `npm run typecheck` clean. CI always runs cold → deterministic.
- Known artifact: the FLAKE-RESOLVESITE class (warm local vitest cache, order-dependent) can fail
  `tests/integration/page-templates.test.ts` or a `resolveSite` assertion ~1/3 of warm runs; it
  passes in isolation and on a cold run. NOT a regression — record in the PR body + run log, don't block.

---

## Phase status

Status vocab: `pending-plan` → `ready` → `in_review` → `complete` | `blocked`
A phase flips `pending-plan → ready` only once its plan doc is committed to `main` (Routine B's prep).

| Phase | Title | Plan | Status | Branch / PR | Notes |
|---|---|---|---|---|---|
| P10 | Domain provisioning (Cloud Run mapping, DNS, SSL) | `2026-06-28-p10-domain-provisioning.md` | **ready** | — | Bootstrapped 2026-06-28 from the live scoping research. Builds on the existing skeleton (site_domains, run-domains.ts Cloud Run mapping + AUTOMATIC SSL, orchestrator.ts whose DNS step is hardcoded to Kinsta). Incorporates the 2026-06-28 spec (pluggable DnsProvider, retire Kinsta). D-050 (DNS provider), D-051 (custom client domains). |
| P11 | CRM integration + CTM install | _(B preps)_ | **pending-plan** | — | Routine B writes the plan after P10 merges. CTM = CallTrackingMetrics (see the `ctm` skill / API). |
| P12 | Hardening + first real client migration | _(B preps)_ | **pending-plan** | — | Per PLAN.md / D-021 (Plausible/Umami analytics), D-019 pg-boss workers, rate limiting, web-vitals, error tracking, first live client migration. Final phase. |

---

## Run log

(Each routine run appends one line: `YYYY-MM-DD HH:MM — run: reviewed <phase> (merged/blocked), built <phase> (PR #N), prepped <phase>`.)

- 2026-06-28 — setup: A/B system created mirroring anchor-operations `ops-rebuild`. Phases 1–9
  already complete & deployed to prod (rev 00032-tsd; Phase 9 SEO shipped via PR #1). P10 plan
  bootstrapped + marked `ready`; P11/P12 `pending-plan` (Routine B preps each as wrap-up). Cloud
  routines created via /schedule: `sites-rebuild-A` (id `trig_01DZT2rcE4cYDsfZUzvhcGgb`,
  `17 1-23/4 * * *`, first run 2026-06-29 05:17 UTC) + `sites-rebuild-B` (id
  `trig_01ELQjhHMMfMcjaXc1pcUsDP`, `17 3-23/4 * * *`, first run 2026-06-29 03:17 UTC) — model
  claude-sonnet-4-6, env env_01WDeAQYFDWv4J1Qs9qFX4U8. 4h cadence on odd UTC hours, offset from
  anchor-operations (ops-A builds even hours :00) so two heavy builds never collide and fleet token
  usage stays bounded. NOTE: PR #2 (Remove Kinsta → pluggable DnsProvider, GoDaddy default) was
  merged to main outside this system 2026-06-28 — it already did much of P10's D-050 DNS work;
  Routine A will re-read the P10 plan against current code and skip what's done. First B run at
  03:17 has nothing in_review and P10 is already `ready`, so it will no-op (no prep). First A run at
  05:17 builds P10.
