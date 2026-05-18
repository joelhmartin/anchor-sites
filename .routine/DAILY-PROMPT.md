# AnchorCorps Site Builder — Daily Routine Prompt

You are working on the AnchorCorps Site Builder. This is a long-running, multi-day project. You are one of many sequential routine runs that will collectively complete it. Your job today is to advance the project by one focused work block (~2–4 hours of effort), then stop.

## On every run, in this exact order

### 1. Orient yourself

Read these files **before doing anything else**:

1. `ROUTINE-README.md` — work loop and hard rules
2. `.routine/STATE.json` — current phase, current task, last commit, open blockers
3. `PLAN.md` — master phase checklist and architectural anchors (the "do not violate" list)
4. The current phase MD file referenced in `STATE.json` (e.g., `PHASE-01-foundation.md`)
5. `BLOCKERS.md` — any open blockers from previous runs
6. `DECISIONS.md` — past architectural decisions, do not re-litigate

If any of these files are missing, halt and email the user with the missing files.

**First-run handling:** If `STATE.json.current_task` is `null` **and** `phase_started_at` is `null`, this is the first run. Pay special attention to `DECISIONS.md` entries **D-010** (Cloud Run, not Vercel — remove `vercel.json` in Task 1.8), **D-011** (no backend exists yet — Task 1.0 must run before Task 1.1), and **D-012** (operational pointers: Resend for email, Vitest for tests, node-pg-migrate for migrations). These describe non-obvious starting conditions that PLAN.md alone does not convey.

### 2. Check for stop signals

- If `.routine/PAUSE` exists: send a daily digest email summarizing state, then stop.
- If `BLOCKERS.md` has open blockers that prevent all remaining tasks in the current phase: send a daily digest if 24h have passed since last email, then stop.
- If the current phase is complete and `.routine/NEXT-PHASE-APPROVED` does not exist: stop. Do not start the next phase.
- If `.routine/NEXT-PHASE-APPROVED` exists and the previous phase is complete: delete that file, expand the next phase's task file (ask user for confirmation on the detailed task list before executing if the phase MD doesn't already exist in detailed form), update `STATE.json`, and begin.
- **Phase expansion within Phase 1:** Task 1.0 (Backend scaffold) is listed in `PHASE-01-foundation.md` as a stub. On the first run, expand it into a detailed sub-task list, email the user for confirmation, and wait for a `.routine/TASK-1.0-APPROVED` file (same convention as phase approval). Do not start coding Task 1.0 until that file exists.

### 3. Verify baseline

Before writing any new code, run the baseline smoke tests captured in `.routine/baseline-tests.log` (or the test suite if no baseline file exists yet).

- If a previously passing test is now failing: **halt forward progress**. Investigate. If you can fix it cleanly, do so and commit as `fix: restore <test name>` before continuing. If you cannot, append a blocker to `BLOCKERS.md`, send a test regression email, and stop.
- If baseline is clean: proceed.

On the very first run there is no baseline yet — Task 1.1 will create it. Skip this step on run 1 and capture the baseline as part of Task 1.1.

### 4. Pick the next task

Open the current phase MD file. Find the first unchecked `[ ]` checkbox. That is your task for this run.

If the task is large (more than ~3 hours of work), split it: execute the first natural chunk, commit, update the phase log, and stop. The next run will continue.

### 5. Execute

- Write the code, write the tests, run the tests
- Use `ac-` class prefix on all global components
- Use CSS custom properties for colors (`--theme-main`, etc.)
- Do not declare `font-family` in component CSS
- Use Font Awesome over inline SVG
- Do not wrap component output in `<html>` or `<body>` tags
- Deploy target is **Google Cloud Run** (see D-010). Do not add Vercel-specific code or config; remove `vercel.json` when Task 1.8 lands.
- Commit with conventional commit format: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
- Each commit message should reference the phase and task ID (e.g., `feat(P1-T1.4): block renderer with schema validation`)

If you encounter an architectural choice not covered by `DECISIONS.md`:
- If small (naming, file location, etc.): make it, append to `DECISIONS.md`, continue
- If significant (a new dependency, an API shape that affects later phases, a deviation from architectural anchors): append a blocker, do not guess

### 6. Update state files

After the task is complete (or after the chunk you completed):

1. **Tick the checkbox** in the phase MD file from `[ ]` to `[x]`
2. **Append to the phase's `## Completion log` section** with this format:
   ```
   ### YYYY-MM-DD HH:MM UTC — Task X.Y (chunk N if applicable)
   **Commit:** <short SHA>
   **Done:** <one-line summary>
   **Tests added:** <count + names>
   **Next:** <next task ID or "phase complete">
   **Notes:** <anything worth recording>
   ```
3. **Update `.routine/STATE.json`** atomically:
   - `current_task`
   - `last_commit_sha`
   - `tests.current_pass`, `tests.current_fail`, `tests.last_run_at`
4. If you made a decision: append to `DECISIONS.md`
5. If you raised a blocker: append to `BLOCKERS.md`
6. If the task produced something visible: append to `DEMO-LOG.md`

### 7. Send emails per triggers

Check `.routine/EMAIL-TRIGGERS.md` against what just happened. Send any email types that fire. Update `STATE.json`'s `emails_sent` and `demo_milestones_sent` to prevent duplicates.

**Anti-spam check before sending:**
- More than 5 non-critical emails today? Hold non-critical, send critical only.
- Demo milestone fires within 30min of a phase completion? Combine into one email.
- Same demo milestone ID already in `demo_milestones_sent`? Skip.

### 8. Decide whether to continue or stop

Continue with the next task **only if all of these are true:**
- The current task fully completed cleanly (not a partial chunk)
- Less than 3 hours of routine time elapsed this run
- All tests are green
- No blockers were raised in this run
- Current phase still has unchecked tasks

Otherwise: stop here. The next run picks up tomorrow.

### 9. Final stop actions

Before exiting:
- Confirm `STATE.json` is consistent with what was actually committed
- Confirm all expected emails were sent
- If 24h have passed since the last email of any type and there was activity, send a daily digest
- Push all commits

## Hard rules (never violate)

1. **Never auto-advance past a phase boundary.** Phase completion always waits for the user to create `.routine/NEXT-PHASE-APPROVED`.
2. **Never break the baseline tests.** If they break, halt.
3. **Never delete entries** from `DECISIONS.md`, `BLOCKERS.md`, or `DEMO-LOG.md`. Mark resolved with timestamps; do not erase.
4. **Never violate the "Architectural anchors" section of `PLAN.md`.** If a task seems to require it, raise a blocker.
5. **Never edit `PLAN.md`'s prose without flagging.** Tick phase checkboxes only.
6. **Never modify `STATE.json` past values.** Append to `emails_sent`, update current pointers — never rewrite history.
7. **Never write code without tests.** Every feature gets at least one test. Every bug fix gets a regression test.
8. **Never commit secrets.** API keys, DB URLs, tokens go in Secret Manager. If you need a new secret, raise a blocker.
9. **Never deploy directly to production** without the user's approval recorded in `DECISIONS.md`. Phase 1 explicitly approves the first production deploy in Task 1.8.
10. **Never use `<form>` tags inside React components.** Forms are CRM embeds rendered as inline HTML (Phase 11).
11. **Never deploy to Vercel.** Cloud Run is the only sanctioned target (D-010). Remove `vercel.json` when Task 1.8 lands.

## When in doubt

- If a decision affects more than one phase: raise a blocker
- If a dependency upgrade is needed: raise a blocker
- If the user's existing code does something that conflicts with a planned task: raise a blocker, propose options
- If you're about to spend more than 30 minutes debugging a single issue: commit a WIP branch, raise a blocker, move on to an unblocked task if possible

## What good looks like at the end of a run

A human looking at this repo can answer all of these in under 60 seconds:

- What phase are we in? *(top of `PLAN.md` + `STATE.json`)*
- What was done today? *(latest entry in current phase's completion log)*
- Is anything blocked? *(`BLOCKERS.md`)*
- Is there something new to look at? *(top of `DEMO-LOG.md`)*
- Are tests green? *(`STATE.json.tests`)*

If a human cannot answer those in under 60 seconds at end-of-run, the state files are not being maintained well enough. Fix it on the next run.

## Begin

Start at step 1.
