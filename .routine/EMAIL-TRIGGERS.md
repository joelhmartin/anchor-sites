# Email Triggers

> **Routine instructions:** Send emails per the rules in this file. Use templates from `.routine/templates/`. Record every sent email in `.routine/STATE.json` under `emails_sent` with timestamp, type, and subject. Never send the same demo milestone email twice — check state first.

## Recipient

Primary: configured in `.routine/STATE.json` under `notify_email` (set this manually before starting).

## Email types

### 1. Phase started

**Fires:** First task of a phase is marked complete.
**Subject:** `[Builder] Phase N started: <phase name>`
**Body includes:**
- Phase goal (one sentence from phase MD)
- Estimated duration
- Link to phase MD file in the repo
- Baseline test count (pass/fail)

### 2. Demo milestone

**Fires:** Any task marked with a "Demo milestone:" callout in its task list completes.
**Subject:** `[Builder] Demo ready: <short description>`
**Body includes:**
- What to look at (URL, route, or curl command)
- What's new since last demo
- One-line on what comes next
- "Reply if anything looks off" CTA

**Idempotency:** Each demo milestone has a stable ID (e.g., `phase1-blockrenderer-demo`). Check `STATE.json` before sending — never repeat.

### 3. Phase completed

**Fires:** Final task of a phase is checked off, all DoD criteria met.
**Subject:** `[Builder] ✓ Phase N complete — ready for Phase N+1?`
**Body includes:**
- Summary of what was built (3–5 bullets)
- Demo URLs
- Test coverage delta
- Next phase preview (one paragraph)
- **Explicit gate:** "Reply 'go' to start Phase N+1, or reply with concerns/changes."

**Critical:** Routine MUST NOT auto-advance to the next phase. Wait for human "go" signal in repo via a `.routine/NEXT-PHASE-APPROVED` file or equivalent signal mechanism.

### 4. Blocker raised

**Fires:** New entry appended to `BLOCKERS.md`.
**Subject:** `[Builder] ⚠ Blocker: <one-line summary>`
**Body includes:**
- The blocker description
- What was being attempted
- What the routine tried
- Specific question for the human
- Link to the relevant phase task

**Routine behavior on blocker:** Continue with any unblocked tasks if possible. If everything depends on the blocker, pause and send daily digest until resolved.

### 5. Daily digest

**Fires:** 24h elapsed since last email of any type AND there has been activity.
**Subject:** `[Builder] Daily digest — <date>`
**Body includes:**
- Tasks completed in the last 24h
- Tasks in progress
- Current blockers (if any)
- Next planned task
- Test status
- Commit count

### 6. Test regression

**Fires:** A previously passing test starts failing.
**Subject:** `[Builder] ⚠ Test regression: <test name>`
**Body includes:**
- Which test
- Which commit introduced the failure
- Error output (truncated to ~30 lines)
- Whether the routine rolled back or is investigating

**Routine behavior:** Halt forward progress until test is green again. This is the safety net protecting auth/blog/events flows.

## Anti-spam rules

- No more than 5 emails per calendar day except for blockers and test regressions
- If a demo milestone and a phase completion would fire within 30 minutes of each other, combine into one email
- Daily digest skips if any other email fired that day
- Test regression emails throttle to one per 4 hours per test (avoid loops)

## Format conventions

- Plain text or simple HTML (whatever your email service handles best)
- Subject prefix `[Builder]` on every email so they thread/filter cleanly
- Include relevant git commit short SHA in footer of every email
- Include link to `PLAN.md` at HEAD in footer
