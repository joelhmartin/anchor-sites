# AnchorCorps Site Builder — Routine Workspace

This repo started as the AnchorCorps core site template. It is now being evolved into a multi-tenant site builder by a Claude routine.

## For the routine

**Read these files in order on first run:**
1. `PLAN.md` — master plan and architectural anchors. Do not violate these.
2. `PHASE-01-foundation.md` — current phase task list. Work top to bottom.
3. `DECISIONS.md` — past decisions, do not re-litigate without flagging.
4. `.routine/EMAIL-TRIGGERS.md` — when and how to email.
5. `.routine/STATE.json` — runtime state. Update atomically.

**Work loop:**
1. Read `STATE.json` → identify current task
2. Read the current phase MD file → find next unchecked task
3. Execute task, write tests, commit
4. Tick the checkbox in the phase MD file
5. Append a timestamped entry to the phase's `## Completion log`
6. Check email triggers — send any that fire
7. Update `STATE.json`
8. If end of phase reached: do not advance, send phase-completed email, exit

**Hard rules:**
- Never violate an item in `PLAN.md`'s "Architectural anchors" section
- Never auto-advance past a phase boundary — wait for `.routine/NEXT-PHASE-APPROVED` file
- Never delete entries from `DECISIONS.md`, `BLOCKERS.md`, or `DEMO-LOG.md`
- Never break baseline smoke tests — if you do, halt and email
- Never put HTML/body tags around component output (per user preference)
- Always use `ac-` class prefix on global components
- Always use Font Awesome over inline SVG
- Never declare `font-family` in component CSS

## For the human

**To kick off the routine:**
1. Set `notify_email` in `.routine/STATE.json`
2. Commit and push
3. Point your routine runner at this repo

**To approve a phase:**
- Create `.routine/NEXT-PHASE-APPROVED` (any contents), commit, push
- Routine will expand the next phase file and begin

**To pause:**
- Create `.routine/PAUSE` (any contents), commit, push
- Routine will finish its current task, send a digest, and stop

**To check status without waiting for an email:**
- Look at `.routine/STATE.json` for machine state
- Look at the current phase MD file's `## Completion log` for narrative

## Repo conventions

- `ac-` class prefix on every global component
- CSS custom properties for colors: `--theme-main`, `--theme-accent`, etc.
- No `font-family` declarations in component CSS
- Font Awesome over inline SVG
- No `<html>` / `<body>` tags wrapping component output
- Tiptap for any rich text field (Phase 5+)
- All cross-service calls idempotent with idempotency keys
- All migrations have rollbacks
- Block schemas are the source of truth — Zod-first development
