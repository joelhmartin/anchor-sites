# Big-Picture Audit — Slice: Background Jobs, Queues, and State Machines

Date: 2026-07-30. Branch: `feat/lovable-workspace` @ 8a379aa. Static analysis only (no DB/network).
All paths relative to `/Volumes/G-DRIVE SSD/DEVELOPER/anchor-sites/`.

## 0. Verified environment facts (premise checks)

- **pg-boss version: 12.18.2** (`package.json:49`, `node_modules/pg-boss/package.json`). Brief's "v12 stately silently drops duplicate singleton keys" premise is **correct**: `send()` returns `null` on a singleton collision; `standard` policy ignores `singletonKey` entirely.
- **Queue defaults** (`node_modules/pg-boss/dist/plans.js` `QUEUE_DEFAULTS`): `retry_limit: 2`, `retry_delay: 0`, `retry_backoff: false`, `expire_seconds: 900` (15 min), `retention: 14d`, `deletion: 7d`. Any queue created without options and any `send()` without retry options inherits **2 immediate, un-backed-off retries and a 15-minute expiration**.
- **`stately` semantics** (`node_modules/pg-boss/dist/types.d.ts:180-182`): "only allows 1 job per state, queued and/or active" — one `created` + one `active` per key CAN coexist; dedupe collapses a second *queued* job only. (This softens one worry: a publish-export enqueued while a prior export is *active* still queues.)
- **Worker topology**: the Express web process IS the only worker (`src/server/index.ts:48` `bootJobs(pool)`), deployed on Cloud Run with `--min-instances=0`, `--max-instances=10`, `--timeout=60s`, `--no-cpu-throttling` (`cloudbuild.yaml:146-158`). `--no-cpu-throttling` keeps CPU while an instance exists; it does **not** prevent scale-to-zero or scale-in SIGTERM.
- Brief premise "the KNOWN git.export no-manual-retry gap": confirmed as stated in the handoff (`docs/superpowers/handoffs/2026-07-30-lovable-workspace-handoff.md:39`) — the gap is the *workspace publish path* (a failed publish-triggered export has no retry because a second publish is a no-op); the Studio GitCard *does* have a manual "Export now" (`src/server/routes/admin-git.ts:200-240`). The brief's phrasing is imprecise but the underlying gap is real (see D611).

## 1. Census (M = 16 units)

Jobs (8):
- U1 pg-boss bootstrap + queue/policy configuration (`src/server/jobs/index.ts`) + deploy topology (`cloudbuild.yaml`)
- U2 `media.process-upload` (`src/server/jobs/media-process-upload.ts`; enqueue `src/server/routes/media.ts:194`)
- U3 `template.materialize` (`src/server/jobs/materialize-template.ts`; enqueue `src/server/routes/templates.ts:112-118`)
- U4 `crm.sync` (`src/server/crm/sync-job.ts`; enqueues `src/server/sites/create-site.ts:156`, `src/server/routes/admin-sites.ts:296,313`)
- U5 `ai.agent-turn` (`src/server/jobs/agent-turn.ts`; enqueues `src/server/routes/admin-ai-agent.ts:133`, self-continuation `agent-turn.ts:159-165`)
- U6 `git.export` (`src/server/jobs/git-export.ts` + `src/server/git/export.ts`; enqueues `admin-git.ts:78`, `admin-pages.ts:219,751`)
- U7 `git.import` (`src/server/jobs/git-import.ts`; enqueue `src/server/routes/git-webhook.ts:107-118`)
- U8 `site.provision` (`src/server/jobs/site-provision.ts` + `src/server/provisioning/orchestrator.ts`; enqueue `create-site.ts:112-140`)

State machines (8):
- U9 `ai_conversations.status`: `active | running | error | archived` (+ 10-min stale-takeover lock) (`src/server/ai/agent/repo.ts:126-182`, migration `1747602000000`)
- U10 `media_assets.variants_status`: `pending | processing | ready | failed` (migration `1747573000000:32`)
- U11 `site_domains.verification_status` (`pending|verified|failed`) × `ssl_status` (`pending|active|failed`) (migration `1747571000000:42-52`; writers: orchestrator, `site-provision.ts:74`, `admin-domains.ts:273,317`)
- U12 `sites.status`: `active | archived | suspended` (migration `1747571000000:21-25`)
- U13 `pages.status`: `draft | published` + publish/revision flow (`admin-pages.ts:47,704-799`, `page_revisions` append-only)
- U14 `site_git_state`: `enabled` flag + `last_export_sha`/`last_import_sha`/`last_error` (`src/server/git/state-repo.ts`)
- U15 Agent turn result machine: `completed | tool_limit | token_budget | deadline | error` + continuation chain ×3 (`src/server/ai/agent/loop.ts:30-46`, `agent-turn.ts:108-157`)
- U16 `pgboss.job` state machine as consumed by the product: `created/retry/active/completed/cancelled/failed` (`hasLiveAgentTurnJob` `admin-ai-agent.ts:149-175`, `hasLiveExportJob` `admin-git.ts:96-110`, health endpoint `src/server/routes/admin-jobs.ts`)

## 2. State/transition enumeration (including MISSING transitions)

**U9 ai_conversations.status**
- Transitions present: `active→running` (claim), `error→running` (resume claim), stale-`running→running` (takeover after 10 min), `running→active` (release, conditional), `*→error` (unconditional), `running→error`. `archived` has **no writer anywhere** (no archive route/tool found) — dark state that the drawer nonetheless filters on (`useAgentConversation.ts:324`).
- Missing: `running→active` when a worker dies (nothing proactive — only a *later* claim attempt reconciles, D601); `error→active` without a new message (resume requires sending a message); `archived→*` and `*→archived` (unreachable).

**U10 media_assets.variants_status**
- Present: `pending→processing→ready`, `processing→failed` (handler catch), `failed→(re-enqueue via /complete)→processing`.
- Missing: `processing→failed` when the *process* dies (catch never runs) — combined with `/complete` refusing re-enqueue while `processing` (`media.ts:189`), `processing` is a trap state (D604). No `ready→pending` (reprocess after variant-spec change) — accepted design (content-hashed keys), n-a.

**U11 site_domains verification/ssl**
- Present: `pending→verified/active` (orchestrator wait, poll route), `pending→failed` (job markFailed), `failed→pending` (poll route silently, provision route), `verified→pending` (poll route on condition flap — a *downgrade with no guard*), `failed→verified` (successful retry).
- Missing: poll route can never write `failed` (a mapping deleted out-of-band reads as `pending` forever); no transition guard at all — three writers free-write any value (D608).

**U12 sites.status**
- Present: none. **No code writes `sites.status`** (`grep UPDATE sites SET` — only brand_tokens/seo/crm_site_id writers). `archived`/`suspended` unreachable; renderer requires `status='active'` (`src/middleware/resolveSite.ts:156,170`); CRM deprovision branch keys off `archived` and is dead code (`admin-sites.ts:306-308`, self-acknowledged "status not in patchSitePayload yet") (D607).

**U13 pages.status**
- Present: `draft→published` (single-page save `status` field, bulk publish), `published→draft` (single-page save accepts `draft` — per-page unpublish exists). Revisions append-only, restore is non-destructive (new revision). No page-delete route found in `admin-pages.ts`/`admin-sites.ts` (repo-repo deletion is out of this slice's scope but noted: git-import explicitly refuses to delete pages).
- Missing: site-level unpublish; server-side mutual exclusion with a running build (D610).

**U14 site_git_state**
- Present: `enabled` toggled both ways (upsert); `last_export_sha`/`last_import_sha` advance monotonically per success; `last_error` set on any failure, cleared by ANY subsequent success in EITHER direction (D616).
- Missing: no per-direction error; no "export/import in-flight" state (in-flight is only observable via `pgboss.job` reads).

**U15 agent turn machine**
- Present: `completed`, `error`, `token_budget` terminal; `tool_limit→(re-enqueue round n+1)` up to 3, then paused-note + `active`. `deadline`/`promoted` is documented-dead (route-only path deleted by Task A2; kept for unit tests) — dark-but-documented, pass.
- Missing: no operator abort transition (D612); no transition when the continuation enqueue itself fails other than bare `error` (D613).

**U16 pgboss.job (as consumed)**
- `failed` is a terminal state **no product surface reads** — not the health endpoint (queuedCount only), not any admin UI (no consumer of `/api/admin/jobs/health` exists under `src/admin/`) (D606). `cancelled` unreachable (no `cancel()` call sites).

## 3. Ledger (16 units × 20 lenses = 320 cells; verdict per cell)

Lenses: Term=Terminality, Str=Structure/Grain, Org=Organization, Prov=Provenance→Consumption, Comp=Comprehension, Vis=State-Visibility, Hon=Honesty, Rev=Reversibility/Safety, Idem=Idempotence/Accretion, Fail=Failure/Recovery, Pre=Precondition/Forward-path, Pop=Population/Dark, Sib=Sibling-Coherence, Gate=Gating-Axis, Temp=Temporal-Integrity, Cost=Cost/Value, Con=Contract-Stability, Nam=Naming, Conc=Concurrency, Obs=Observability.

| Unit | Term | Str | Org | Prov | Comp | Vis | Hon | Rev | Idem | Fail | Pre | Pop | Sib | Gate | Temp | Cost | Con | Nam | Conc | Obs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 boot/config | D600 | pass | pass | pass | pass | pass | pass | pass | pass | D622 | pass | pass | pass | pass | D600 | pass | pass | pass | pass | D606 |
| U2 media job | D604 | pass | pass | pass | D615 | pass | pass | n-a | D615 | pass | pass | pass | pass | pass | pass | pass | pass | pass | D615 | D606 |
| U3 materialize | D620 | pass | pass | pass | pass | D620 | pass | n-a | D605 | D620 | pass | pass | D605 | pass | pass | pass | pass | pass | D605 | D606 |
| U4 crm.sync | pass | pass | pass | pass | D619 | pass | pass | n-a | pass | pass | pass | D607 | pass | pass | pass | pass | pass | pass | pass | D606 |
| U5 agent-turn job | D601 | pass | pass | pass | pass | pass | D613 | pass | pass | D613 | pass | pass | pass | pass | D614 | D612 | pass | pass | pass | D606 |
| U6 git.export | pass | pass | pass | pass | pass | pass | pass | pass | pass | D618 | pass | pass | pass | pass | pass | pass | pass | pass | D618 | D606 |
| U7 git.import | pass | pass | pass | pass | pass | pass | D602 | pass | pass | D603 | pass | pass | pass | pass | pass | pass | pass | pass | pass | D606 |
| U8 site.provision | pass | pass | pass | pass | pass | D609 | pass | pass | pass | pass | D609 | pass | pass | pass | D617 | pass | pass | pass | pass | D606 |
| U9 conv.status | D601 | pass | pass | pass | pass | pass | pass | pass | pass | D601 | pass | D621 | pass | D621 | D601 | n-a | pass | pass | pass | pass |
| U10 variants_status | D604 | pass | pass | pass | pass | pass | pass | n-a | pass | D604 | pass | pass | pass | pass | D604 | n-a | pass | pass | pass | pass |
| U11 domain statuses | pass | pass | pass | pass | pass | D609 | D608 | pass | pass | D608 | D609 | pass | D608 | pass | pass | n-a | pass | pass | D608 | pass |
| U12 sites.status | n-a | pass | pass | D607 | pass | pass | pass | n-a | n-a | n-a | n-a | D607 | pass | pass | n-a | n-a | pass | pass | n-a | n-a |
| U13 pages/publish | pass | pass | pass | pass | pass | pass | pass | pass | pass | D611 | pass | pass | pass | pass | pass | pass | pass | pass | D610 | pass |
| U14 git state | pass | D616 | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | D616 | pass | pass | n-a | pass | pass | pass | pass |
| U15 turn machine | pass | pass | pass | pass | pass | pass | pass | D612 | pass | D613 | pass | pass | pass | pass | pass | D612 | pass | pass | pass | pass |
| U16 pgboss states | D606 | pass | pass | D606 | pass | D606 | pass | n-a | pass | D606 | pass | pass | pass | pass | D606 | n-a | pass | pass | pass | D606 |

Cell totals: 320 filled (0 blank). Directive-flagged cells: 64. n-a: 19. Pass: 237.
Distinct directives: 23 (D600–D622).

Selected pass rationales (so passes are auditable, not vibes):
- U1 Idem: `bootPromise` guard + idempotent `createQueue`/`work` re-registration; noop handle when disabled is honest.
- U5 Idem: `retryLimit: 0` + `stately` + DB claim is a correct three-layer defense for non-idempotent turns; continuation key `${conversationId}:c${n}` correctly avoids both cross-conversation collision and round-0 collision (`agent-turn.ts:56-58`).
- U6 Idem/Hon: content-hash diff no-op export (`export.ts:89-98`) and empty-repo bootstrap path are sound; `null`-send disambiguation via `hasLiveExportJob` is the right v12-stately pattern.
- U7 Idem: `last_import_sha` gate + validate-before-apply + 404-race downgrade + bounded commit comment + recordImport/recordGitError ordering are all correct and unusually well-reasoned.
- U8: `wait_ready`-timeout-is-not-failure distinction (`site-provision.ts:111-135`) is exactly right; enqueue-after-commit thunk (`create-site.ts:112`) closes the visibility race properly; `retryLimit:5, retryDelay:60, backoff` ≈ 50 min coverage matches its own math.
- U13: bulk publish is idempotent (WHERE status != 'published'), revision-per-page snapshot preserved, `live_url_ready` honesty fix is real.

## 4. Directives (D600+)

[D600] (U1 deploy topology) × (Terminality) — «A durable queue whose only worker can cease to exist must not be the system's execution guarantee.» Instance: «the sole pg-boss worker is the web process (`src/server/index.ts:48`) on Cloud Run `--min-instances=0` (`cloudbuild.yaml:146`); at zero instances NOTHING runs — queued continuation rounds, provision retries (60s–16min delays routinely outlive idle-down), media retries, and pg-boss's own expiration sweep all sit until the next HTTP request happens to spawn an instance, and scale-in SIGTERM (10s grace + `stop({graceful:true})`, `jobs/index.ts:128`) kills a 30-tool-call turn mid-flight with `retryLimit:0` so it is never re-run. `--no-cpu-throttling` (docs/deploy.md §5b) fixes CPU-while-alive, not existence.» Fix-class: «set `--min-instances=1` (smallest change), or split a dedicated always-on worker service consuming the same queues.»

[D601] (U9 conversation lock × U5) × (Terminality) — «Every stranded lock needs an active reconciler, not just a lazy takeover.» Instance: «a worker death mid-turn leaves `status='running'` forever; the only recovery is a NEW claim attempt ≥10 min later (`repo.ts:152-161`), which only happens if the operator sends another message (409 "turn already running" until then, `admin-ai-agent.ts:221`); the workspace meanwhile shows a busy build indefinitely (`useAgentConversation.ts:136`) and no sweeper, alarm, or tail-side staleness check exists.» Fix-class: «SSE tail poll (or a periodic job) flips `running` with `updated_at < now()-10min` to `error` + appends a "build was interrupted — Resume to continue" note.»

[D602] (U7 webhook enqueue) × (Honesty) — «Never acknowledge receipt of work you did not durably record.» Instance: «`git-webhook.ts:240-247` ignores `enqueueImport`'s return — the default impl swallows every failure to `null` (`:115-117`) — then `queued.push(slug)` and 202s GitHub unconditionally; with the queue down the push is acknowledged and lost forever (the idempotency gate never advances, and the next push imports only ITS OWN changed paths, so the lost edits are never re-imported unless the same files change again).» Fix-class: «check for `null` → disambiguate via a `hasLiveImportJob(siteId, headSha)` read (existing `admin-git.ts:96` pattern) → genuine failure returns 5xx so the GitHub delivery log shows failed and redelivery works.»

[D603] (U7 git.import) × (Failure/Recovery) — «A validated-input job that can fail transiently needs deliberate retry policy and a manual re-drive path.» Instance: «GIT_IMPORT is created with policy only (`jobs/index.ts:242`) and enqueued with no retry options (`git-webhook.ts:112`) → v12 defaults: 2 immediate retries, zero delay, no backoff — exactly wrong for GitHub 5xx/network blips; after exhaustion the job is `failed` with no dead-letter surface and NO route anywhere re-enqueues an import (recovery = push a dummy commit).» Fix-class: «pass `retryLimit`/`retryDelay`/`retryBackoff` at `createQueue`, add an admin "re-import sha" endpoint that re-enqueues `{siteId, headSha, paths}` from the failed job row.»

[D604] (U10 variants_status) × (Terminality) — «No state may be simultaneously non-terminal and non-retryable.» Instance: «worker death mid-processing leaves `variants_status='processing'` (the catch at `media-process-upload.ts:141-151` never ran); once pg-boss's 2 default retries are consumed the same way, `/complete` refuses re-enqueue forever (`media.ts:189-192` returns `enqueued:false` for `processing`) — the asset is permanently stuck with no operator affordance and no staleness sweep.» Fix-class: «`/complete` treats `processing` with `processed_at IS NULL AND created_at < now()-15min` as retryable (re-enqueue), matching the `failed` branch.»

[D605] (U3 template.materialize) × (Idempotence) — «A singletonKey on a `standard` queue is a no-op; either enforce the policy or delete the claim.» Instance: «`templates.ts:109-118` sends with `singletonKey: ${siteId}:${templateId}` and a comment claiming "deduped per (site, template) so a double-submit…", but the queue is created with NO policy (`jobs/index.ts:171`) — the exact singletonKey-inert-under-`standard` bug this codebase already diagnosed and fixed for AGENT_TURN/GIT_EXPORT/GIT_IMPORT/SITE_PROVISION was missed on its fifth queue; double-submits queue duplicate materializations (harmless only because the handler is ON-CONFLICT idempotent — the comment is still false armor).» Fix-class: «`createQueue(TEMPLATE_MATERIALIZE, { policy: "stately" })` + treat `null` send as deduped in the route, or delete the singletonKey and the comment.»

[D606] (U16 job observability) × (Observability/State-Visibility) — «Failed jobs must be visible from the product, not only from Cloud Logging/SQL.» Instance: «`admin-jobs.ts:19` QUEUES omits GIT_EXPORT, GIT_IMPORT, SITE_PROVISION entirely; the endpoint returns only `queuedCount` (its own doc comment at `:4` claims "oldest pending job age" — not implemented); it reports no active/retry/failed counts; and no file under `src/admin/` consumes `/api/admin/jobs/health` at all — queue depth and dead jobs are invisible without `gcloud`/psql.» Fix-class: «enumerate all 7 queues, add per-state counts (one GROUP BY on `pgboss.job`), and render a small health card in Studio.»

[D607] (U12 sites.status) × (Population/Dark) — «A state no writer can reach is either a missing feature or dead schema — pick one.» Instance: «`archived`/`suspended` have zero writers (verified: no `UPDATE sites SET status` anywhere); yet the renderer hard-gates on `status='active'` (`resolveSite.ts:156,170`) and `admin-sites.ts:306-308` ships a CRM-deprovision branch keyed on `archived` that can never fire ("status not in patchSitePayload yet" — its own admission).» Fix-class: «add `status` to `patchSitePayload` (which also brings the CRM deprovision + crm.sync 'deprovision' action to life), or drop the states and the dead branch.»

[D608] (U11 domain statuses) × (Sibling-Coherence) — «One state column, one transition function.» Instance: «three writers free-write `verification_status`/`ssl_status` with no transition guard: the job's `markFailed` (`site-provision.ts:74-79`), the orchestrator (`orchestrator.ts:197-201`), and the poll route (`admin-domains.ts:317-325`) — the poll silently rewrites `failed→pending` (erasing an exhausted-retry verdict the moment anyone opens the Domains tab) and flaps `verified→pending` on any transient condition read, and can never write `failed` itself (a deleted mapping reads as eternal `pending`).» Fix-class: «one `setDomainStatus(pool, id, next)` with an allowed-transition matrix; poll route may only upgrade or explicitly mark re-checking.»

[D609] (U8 site.provision) × (Precondition/Forward-path) — «When a job fails on a known one-time operator precondition, the failure must carry the instruction.» Instance: «the Webmaster-Central-unverified PermissionDenied (documented `site-provision.ts:23-30`, docs/deploy.md §9) ends, after 5 retries, as a bare `verification_status='failed'` on the row — the actual error detail lives only in the pg-boss job output and Cloud Logging; `site_domains` has no `last_error` column and DomainsTab can only render the word "failed" with no forward path.» Fix-class: «add `site_domains.last_error`, write the failing step's detail in `markFailed`, render it in DomainsTab next to the Provision retry button.»

[D610] (U13 publish) × (Concurrency) — «A server must enforce the mutual exclusions its UI merely suggests.» Instance: «the publish-during-build guard is client-side only (`WorkspacePage.tsx:517-531` disables the button while the agent is running); `POST /api/sites/:siteId/publish` (`admin-pages.ts:704-735`) happily flips every draft to `published` mid-turn — the known mid-build revision-audit race: a half-written page goes live and its half-state is immortalized as a `source:'manual'` revision.» Fix-class: «publish route 409s when any of the site's conversations has `status='running'` (one indexed SELECT).»

[D611] (U13→U6 publish-export trigger) × (Failure/Recovery) — «A fire-and-forget trigger from an idempotent no-op caller is a one-shot with no second chance.» Instance: «`admin-pages.ts:751` `enqueueGitExport(...).catch(() => undefined)` inside another try/catch — a failed enqueue is invisible in the publish response; because a second publish publishes 0 pages it never re-fires (`:747` `published > 0` gate), so the workspace has no export-retry path at all (the handoff's known gap; GitCard's manual export exists but only in the Studio tab).» Fix-class: «include `git_export: {queued|deduped|failed}` in the publish response and surface it in the workspace (or fall back to the disambiguate-then-503 pattern the other two GIT_EXPORT call sites already use).»

[D612] (U15 turn machine) × (Cost/Reversibility) — «Anything that spends money autonomously needs a kill switch and a global ceiling.» Instance: «chat "Stop" only aborts the client SSE tail (`useAgentConversation.ts:55` — no server call); no route cancels a running AGENT_TURN, so a misdirected build burns up to 4 rounds × 30 tool calls × model calls until caps trip; the only spend bound is `AI_AGENT_TOKEN_BUDGET` = 1M tokens/day *per conversation* (`loop.ts:305,339`) — N new conversations = N budgets, with no per-site or global daily ceiling.» Fix-class: «a `cancel_requested` flag on the conversation checked at the top of each loop iteration + a Stop route; add a global (env) daily token ceiling summed across conversations.»

[D613] (U5 continuation) × (Honesty) — «A round-boundary failure must explain itself in the transcript like every other turn-ending failure.» Instance: «`agent-turn.ts:134` neither checks `enqueueContinuation`'s `null` return nor wraps its throw distinctly — a `getBoss()` failure at a continuation boundary lands in the outer catch as a bare `status='error'` with NO persisted text (the A4 `describeAnthropicError` channel covers only Anthropic SDK errors), reviving exactly the "bare amber internal" failure mode A4 was built to kill.» Fix-class: «wrap the enqueue: on throw/null-not-deduped, `appendMessage` a "couldn't queue the next build round — press Resume" note before setting error.»

[D614] (U5 job expiration) × (Temporal-Integrity) — «A job's declared expiration must exceed its worst-case honest runtime.» Instance: «AGENT_TURN inherits the 15-min default `expire_seconds` (no override at `jobs/index.ts:204` or the sends); a long build round (30 tool calls, each a model round-trip) can exceed 15 min — pg-boss then marks the job `failed` (retryLimit 0) while the handler keeps running to successful completion: `pgboss.job` lies, `hasLiveAgentTurnJob` reports no live job while a turn is mid-flight (the DB claim is the only remaining guard).» Fix-class: «set `expireInSeconds` on the AGENT_TURN queue comfortably above worst-case round duration.»

[D615] (U2 media job) × (Comprehension/Idempotence) — «Retry-behavior comments must match the configured (or defaulted) policy.» Instance: «`media-process-upload.ts:20-23` claims "pg-boss retries via its built-in backoff" and contains the garbled sentence "uploads use `if-generation-match` not at the GCS-API level"; actual behavior is the queue default — 2 immediate retries, no backoff — and the enqueue (`media.ts:194`) sets no `singletonKey`, so two racing `/complete` POSTs that both read `pending` enqueue duplicate jobs.» Fix-class: «explicit retry options at createQueue, `singletonKey: asset_id`, fix the comment.»

[D616] (U14 git state) × (Structure/Sibling-Coherence) — «Two independent failure streams must not share one overwriting error slot.» Instance: «`site_git_state.last_error` is written by export failures, import failures, AND import validation summaries; `recordExport`/`recordImport` unconditionally NULL it on success (`state-repo.ts:47-65`) — a successful export erases a still-unresolved import validation report and vice versa, so GitCard's error display is last-writer-wins across unrelated pipelines.» Fix-class: «split into `last_export_error`/`last_import_error`, each cleared only by its own direction's success.»

[D617] (U8 provisioning throughput) × (Temporal-Integrity) — «Long-holding jobs need explicit worker concurrency, not the default serial slot.» Instance: «`boss.work(SITE_PROVISION, ...)` (`jobs/index.ts:258`) uses default batchSize 1 while each attempt intentionally holds up to 4 minutes (`PROVISION_WAIT_TIMEOUT_MS`, `site-provision.ts:58`) — an N-site burst serializes to ~4N minutes of preview-URL latency per instance, worse when min-instances=0 leaves one cold instance doing everything.» Fix-class: «register with `batchSize`/concurrency > 1 (safe: per-domain idempotent, distinct singleton keys), or shorten the wait and lean on the existing retry ladder.»

[D618] (U6 git.export) × (Concurrency/Failure) — «Jobs that contend on one external ref need backoff sized to the contention.» Instance: «up to 10 Cloud Run instances each run a GIT_EXPORT worker; exports for *different* sites share one branch ref — concurrent `updateRef` loses as non-fast-forward and the loser gets only the default 2 immediate retries (no backoff) before landing in invisible `failed` (`export.ts:106-113`, queue created with policy only at `jobs/index.ts:219`).» Fix-class: «`retryLimit`/`retryBackoff` at createQueue (contention is transient by nature); optionally a repo-scoped singleton key if export volume grows.»

[D619] (U4 crm.sync) × (Comprehension) — «Doc claims about idempotency mechanics must be literally true.» Instance: «`sync-job.ts:5-8` claims the job "re-derives the correct action from the stored DB state" — it executes `input.action` verbatim (`:49-67`); and its `deprovision` action is reachable only from the dead `archived` branch (see D607).» Fix-class: «correct the comment (the DB re-read makes retries *safe*, not action-derived); deprovision reachability resolves with D607.»

[D620] (U3 materialize outcome) × (Terminality/State-Visibility) — «An async populate step needs a recorded outcome, not inference from side effects.» Instance: «a materialization that fails after retries (or whose enqueue failed — `templates.ts:436-441` returns `job.queued:false` which `NewSitePage.tsx` never reads) leaves a site with zero pages and zero recorded state; the UI polls `pages_count` with a bounded timeout then "proceeds anyway" silently (`NewSitePage.tsx:148-163`) — the operator lands in a workspace that will never populate, with no error and no retry affordance.» Fix-class: «surface `job.queued:false` in the wizard, and on timeout show "template import didn't finish" with a re-enqueue action (needs a small re-materialize route; handler is already idempotent).»

[D621] (U9 status column) × (Gating-Axis) — «Don't multiplex a mutex, a health flag, and a lifecycle onto one enum.» Instance: «`ai_conversations.status` serves as turn lock (`running`), health (`error`), and lifecycle (`active`/`archived`) on one axis (`repo.ts:126-182`); the unconditional error-release path (`releaseConversationTurn(..., "error")` → bare UPDATE) would clobber a hypothetical `archived`, and archiving mid-turn is undefined — currently masked only because `archived` has no writer (D607's sibling).» Fix-class: «when archive lands, move the lock to its own column (`locked_until` lease — which also closes the DEFERRED no-fencing note at `admin-ai-agent.ts:203-210`).»

[D622] (U1 boss error stream) × (Failure/Recovery) — «Supervisor-loop failures need a persisted, queryable trace.» Instance: «`boss.on("error")` is a bare `console.error` (`jobs/index.ts:111-116`) — a dying pg-boss maintenance loop (the thing that runs retries and expirations) is indistinguishable from a quiet day except by reading Cloud Logging.» Fix-class: «record `lastBossError`+timestamp in module state and expose it via `/api/admin/jobs/health` (pairs with D606).»

## 5. Extra-lens notes not risen to directives

- **Two chat turns racing** (brief's explicit ask): correctly closed by claim-before-append + release-before-enqueue + handler re-claim + stately/retryLimit:0 (`admin-ai-agent.ts:186-275`, `agent-turn.ts:108-113`). The residual no-fencing-token gap is self-documented (`admin-ai-agent.ts:203-210`) and folded into D621.
- **Provision vs re-provision**: manual "Provision" uses the inline route, the job uses the orchestrator — same idempotent steps, no conflict; singletonKey `domainId` prevents double-queuing the job path. Pass.
- **git.export publish trigger while export active**: v12 `stately` allows 1 queued + 1 active per key, so a publish during an active export still queues one follow-up (which re-reads DB state) — the design is sound; only the swallowed-enqueue-failure path is the gap (D611).
- **Job outputs (Provenance)**: `MaterializeTemplateResult` / media variants / `ProvisionResult` returned to pg-boss's `output` column are read by nothing; all consumers poll DB state instead — acceptable (outputs serve debugging), pass with note.
- **Contract-stability**: job names are centralized constants; payload types exported from their handlers (GitImportInput's home in `routes/git-webhook.ts` is a documented cycle-avoidance choice). Pass.

## 6. Completion accounting

Census M=16 · Lenses L=20 · Cells 320/320 filled (100%, 0 blank) · Directives N=23 (D600–D622, 64 directive-flagged cells) · Passes P=237 · n-a Q=19.
