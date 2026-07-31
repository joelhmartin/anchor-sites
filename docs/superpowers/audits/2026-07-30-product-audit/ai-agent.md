# Big-Picture Audit — Slice: AI Build Agent (the product's engine)

Date: 2026-07-30 · Branch: feat/lovable-workspace · Method: static analysis, read-only.
Auditor scope: `src/server/ai/*`, `src/server/ai/agent/**`, `src/server/jobs/agent-turn.ts`,
`src/server/routes/admin-ai-agent.ts`, conversation/message/turn data flow, `docs/ai-agent.md`,
and the first-build experience end-to-end in code (`NewSitePage.tsx` → provision/materialize →
agent turn → chat surfaces in `src/admin/components/agent-chat/`).

## Brief-premise corrections (verified against code)

1. **Model pin is `claude-sonnet-4-6`, not `claude-sonnet-4-5`** — `src/server/ai/config.ts:11`.
   The pin is a documented, deliberate operator call (2026-05-20) with a one-line bump path;
   the comment records that the `claude-api` skill's default is Opus 4.7. Temporal lens: pass.
2. **There is no dedicated resume endpoint.** Resume = the normal
   `POST .../conversations/:id/messages` with the literal `"continue"` (Composer's Resume
   button, `WorkspacePage.tsx:435`). `docs/ai-agent.md` says exactly this; doc and code agree.
3. "30-tool batches, auto-continue ×3" — confirmed: `AI_AGENT_MAX_TOOL_CALLS=30`,
   `AI_AGENT_MAX_CONTINUATIONS=3`, so 4 batches / up to 120 tool calls per user message.

## Census (30 units)

| # | Unit | Anchor |
|---|------|--------|
| 1 | AI config (model pin, modes) | `src/server/ai/config.ts` |
| 2 | SDK client wrapper `runMessage` | `src/server/ai/client.ts` |
| 3 | Block catalog generation | `src/server/ai/catalog.ts` |
| 4 | Agent system prompt `AGENT_SYSTEM_INTRO` | `src/server/ai/agent/loop.ts:54-64` |
| 5 | Phase-6 propose path (Ask-AI prompt + parse) | `src/server/ai/propose.ts` |
| 6 | Edit-op contract + `applyAndValidate` | `src/server/ai/edit-ops.ts` |
| 7 | Block diff | `src/server/ai/diff.ts` |
| 8 | Tool registry/dispatcher | `src/server/ai/agent/tools/index.ts` |
| 9 | Tool `get_site_overview` | `tools/read.ts:10` |
| 10 | Tool `get_page` | `tools/read.ts:52` |
| 11 | Tool `list_templates` | `tools/read.ts:72` |
| 12 | Tool `list_media` | `tools/read.ts:91` |
| 13 | Tool `create_page` | `tools/pages.ts:32` |
| 14 | Tool `update_page` | `tools/pages.ts:105` |
| 15 | Tool `delete_page` | `tools/pages.ts:246` |
| 16 | Tool `set_brand_tokens` | `tools/settings.ts:26` |
| 17 | Tool `set_seo_defaults` | `tools/settings.ts:53` |
| 18 | Tool `set_page_seo` | `tools/settings.ts:93` |
| 19 | Tool `apply_site_template` | `tools/assets.ts:56` |
| 20 | Tool `search_stock_images` | `tools/assets.ts:110` |
| 21 | Tool `import_image` (+ `media/ingest.ts` SSRF path) | `tools/assets.ts:146` |
| 22 | Turn loop `runAgentTurn` | `src/server/ai/agent/loop.ts:277` |
| 23 | Stub turn `runStubTurn` | `src/server/ai/agent/loop.ts:195` |
| 24 | Conversation repo + turn lock | `src/server/ai/agent/repo.ts` |
| 25 | Job handler + auto-continue | `src/server/jobs/agent-turn.ts` |
| 26 | Conversation API + SSE tail | `src/server/routes/admin-ai-agent.ts` |
| 27 | `docs/ai-agent.md` (doc vs code) | `docs/ai-agent.md` |
| 28 | First-build: prompt-only path | `src/admin/pages/NewSitePage.tsx` |
| 29 | First-build: template+prompt ("both-mode") | `NewSitePage.tsx:188-207` |
| 30 | Chat client surfaces (hook/history/steps/composer) | `src/admin/components/agent-chat/*` |

## Lenses (20)

T Terminality · SG Structure/Grain · O Organization · PC Provenance→Consumption ·
C Comprehension · SV State-Visibility · H Honesty · R Reversibility/Safety ·
I Idempotence/Accretion · F Failure/Recovery · PF Precondition/Forward-path ·
PD Population/Dark · SC Sibling-Coherence · G Gating-Axis · TI Temporal-Integrity ·
CV Cost/Value · CS Contract-Stability · N Naming/Least-astonishment ·
PQ Prompt-quality (EXTRA) · S Safety/prompt-injection (EXTRA)

## Ledger (30 × 20 = 600 cells; P = pass, Dxxxx = directive, – = n/a)

| Unit | T | SG | O | PC | C | SV | H | R | I | F | PF | PD | SC | G | TI | CV | CS | N | PQ | S |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 config | P | P | P | P | P | – | P | – | – | P | P | P | P | P | P | P | P | P | – | – |
| 2 client | P | P | P | P | – | – | P | – | P | P | P | P | P | P | P | P | P | P | – | – |
| 3 catalog | – | P | P | P | – | – | P | – | P | P | P | D1114 | P | – | P | P | P | P | P | – |
| 4 agent prompt | P | P | P | P | P | – | P | P | – | P | P | D1100 | P | P | – | P | – | P | D1100 | P |
| 5 propose | P | P | P | P | P | – | P | P | P | P | P | P | P | P | – | P | D1113 | P | P | D1109 |
| 6 edit-ops | P | P | P | P | P | – | P | P | P | P | P | P | P | – | – | P | D1113 | P | – | P |
| 7 diff | – | P | P | P | P | – | P | – | P | P | P | P | P | – | – | P | P | P | – | – |
| 8 dispatcher | P | P | P | P | P | – | P | P | P | P | P | P | P | P | – | P | P | P | – | P |
| 9 get_site_overview | P | P | P | P | P | P | P | – | P | P | P | P | P | P | – | P | P | P | – | P |
| 10 get_page | P | P | P | P | P | P | P | – | P | P | P | P | P | P | – | P | P | P | – | P |
| 11 list_templates | P | P | P | P | P | P | P | – | P | P | P | P | P | P | – | P | P | P | – | P |
| 12 list_media | P | P | P | P | P | P | P | – | P | P | P | P | P | P | – | P | P | P | – | P |
| 13 create_page | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | P | P | – | P |
| 14 update_page | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | D1113 | P | – | P |
| 15 delete_page | P | P | P | P | P | P | P | D1116 | P | P | P | P | P | P | – | P | P | P | – | P |
| 16 set_brand_tokens | P | P | P | P | P | P | P | D1120 | P | P | P | P | P | P | – | P | P | P | – | P |
| 17 set_seo_defaults | P | P | P | P | P | P | P | D1120 | P | P | P | P | P | P | – | P | P | P | – | P |
| 18 set_page_seo | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | P | P | – | P |
| 19 apply_site_template | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | P | P | – | P |
| 20 search_stock_images | P | P | P | P | P | P | P | – | P | P | P | P | P | P | – | P | P | P | – | P |
| 21 import_image | P | P | P | D1117 | P | P | P | P | D1117 | P | P | P | P | P | – | P | P | P | – | P |
| 22 turn loop | P | D1106 | P | P | D1111 | P | D1102 | P | P | D1101 | P | P | P | P | P | D1108 | P | P | – | P |
| 23 stub turn | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | P | P | – | – |
| 24 repo/lock | D1104 | P | P | P | – | P | P | D1119 | P | P | P | P | P | P | P | P | P | P | – | P |
| 25 job/auto-continue | P | P | P | P | P | D1111 | P | P | P | P | P | P | P | P | – | D1112 | P | P | – | P |
| 26 routes/SSE | P | P | P | P | P | D1103 | P | P | P | P | D1115 | P | P | P | – | P | P | P | – | P |
| 27 docs/ai-agent.md | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P |
| 28 first-build prompt | P | P | P | P | P | P | P | P | P | P | P | P | P | P | – | P | P | P | D1100 | P |
| 29 first-build both-mode | P | P | P | P | P | P | P | P | P | P | D1107 | P | P | P | – | P | P | P | D1100 | P |
| 30 chat client | P | P | P | D1110 | P | P | D1105 | P | P | D1118 | P | P | P | P | – | P | P | P | – | P |

**Cells: 600/600 filled — Passes 489 · Directive cells 29 · n/a 82 · Blank 0.**
(D1100 appears in 4 cells, D1113 in 3, D1111/D1117/D1120 in 2 each; 21 distinct directives.)

## Directives (D1100–D1120)

- [D1100] (agent system prompt × Prompt-quality/Population) — «The system prompt must encode the product's design taste: page composition, image strategy, theming, and content depth — not just tool mechanics.» Instance: «`AGENT_SYSTEM_INTRO` (`loop.ts:54-64`) is 10 lines of mechanics; it never mentions `set_brand_tokens`, `search_stock_images`, any SEO tool, per-page nav-bar/rich-footer chrome, block variety, or a quality bar for copy beyond "no lorem ipsum". The prompt-only path (`NewSitePage.tsx:209-217`) also withholds `default_brand_tokens` when a prompt exists, so a from-scratch build that skips templates ships with no theme unless the model volunteers one. This is the operator's #1 recurring complaint (visual quality) and the smallest place to fix it.» Fix-class: «expand `AGENT_SYSTEM_INTRO` with a design-playbook section (image per hero/split-hero, brand-token step, per-page chrome, section ordering, SEO pass at end) + a first-turn site-spec enrichment step for one-line prompts (cf. `build-with-wordpress:site-specification` pattern).»

- [D1101] (turn loop × Failure/Recovery) — «An error the label itself calls transient must be retried before it becomes terminal.» Instance: «429/529 from `messages.create` → `describeAnthropicError` returns "retry shortly", but the loop persists it, sets `status:'error'`, and ends the build (`loop.ts:362-377`); `retryLimit:0` on the job means nothing retries — a 60-second Anthropic overload blip kills a 4-batch build and waits for a human to click Resume. A context-overflow 400 also lands in the generic label with no guidance.» Fix-class: «bounded in-loop backoff retry (e.g. 3× exponential) for status 429/529 before declaring error; add a distinct label + guidance for "prompt too long" 400s.»

- [D1102] (turn loop × Honesty) — «A truncated model response must not be reported as a completed turn.» Instance: «`loop.ts:389-391` treats every `stop_reason !== "tool_use"` as `end_turn` → `endReason:"completed"` — including `stop_reason:"max_tokens"` (output cap 8192 hit mid-answer, possibly mid-plan). The transcript ends on a chopped sentence, the conversation flips to `active`, and the UI reads "done".» Fix-class: «branch on `stop_reason === "max_tokens"`: persist an honest "output was cut short — continuing" note and let `handleAgentTurn` auto-continue it like `tool_limit`.»

- [D1103] (routes/tail × State-Visibility/Failure) — «A queued job that never starts must become visible, not an infinite spinner.» Instance: «after the 202, the conversation is `active` and the tail (`admin-ai-agent.ts:437-546`) only emits on status *change*; if the pg-boss worker is down/crashed (but the enqueue succeeded), no `running` ever arrives — `sending` stays true in `useAgentConversation` forever, with no watchdog and no server-side "queued" state.» Fix-class: «client stall timeout (no message/status event within N seconds of a 202 → surface "build hasn't started" + re-enable composer), or emit a queued/started marker the tail can miss-detect.»

- [D1104] (repo/routes × Terminality) — «Every declared lifecycle state must be reachable; conversations must be closeable.» Instance: «`status:'archived'` exists in the type (`repo.ts:14`), the migration, and the client type, but no route, tool, or UI ever sets it — conversations are unarchivable, and since bootstrap always adopts the newest `active|error|running` conversation (`useAgentConversation.ts:323-325`) each site has exactly one everlasting thread that can never be retired or replaced.» Fix-class: «add `PATCH .../conversations/:id {status:"archived"}` + a "New conversation / Archive" affordance in the workspace panel.»

- [D1105] (chat client × Honesty) — «Stop must stop — or must say it doesn't.» Instance: «`useAgentConversation.stop()` (`useAgentConversation.ts:456-464`) aborts only the POST/tail and appends the system line "Stopped." while the background AGENT_TURN job keeps executing tools and writing pages for up to 4 batches. The operator believes the build halted; the site keeps changing underneath them.» Fix-class: «either implement real cancellation (a `cancel_requested` flag the loop checks between tool calls / pg-boss cancel) or relabel the affordance and message ("Hide progress — the build continues in the background").»

- [D1106] (buildApiMessages × Structure/Grain) — «The conversation's founding brief must never fall out of model context.» Instance: «`buildApiMessages` (`loop.ts:161-180`) sends a 40-row tail (or slices from the *last* user row). One job batch persists up to 61 rows, so after the first build the original business-description message is permanently outside every future window; a later "make the hero warmer" or Resume `"continue"` turn runs with no memory of what the site is for.» Fix-class: «always prepend the conversation's first user message (or a maintained summary row) ahead of the windowed tail.»

- [D1107] (both-mode × Precondition/Forward-path) — «The build agent must not start until the template it is meant to adapt exists — and must be told which template that is.» Instance: «`NewSitePage.tsx:151-197`: `waitForPages` polls 8s then *proceeds anyway on timeout*; the seed message is the raw prompt with no mention of the chosen template. On a slow queue the agent sees an empty site, obeys TEMPLATE-FIRST, and applies a *different* template while the materialize job concurrently inserts the picked one (`ON CONFLICT DO NOTHING`) — a mixed two-template site as the operator's first impression.» Fix-class: «don't proceed on timeout (keep polling / enqueue the conversation from the materialize job's completion), and include "template ‹name› was already applied" in the seed message.»

- [D1108] (turn loop × Cost/Value) — «A multi-call tool loop must cache its growing message prefix, not just the system block.» Instance: «`loop.ts:313-319` puts `cache_control` only on system+catalog; the message history (which contains every full `get_page` dump and tool result, re-sent on all of up to ~120 model calls per user message) is never cache-marked — near-quadratic uncached input spend inside every build, silently eating the 1M/day budget.» Fix-class: «add a `cache_control` breakpoint on the trailing message block per call (standard incremental-caching pattern).»

- [D1109] (agent output → renderer × Safety/prompt-injection) — «Model-authored HTML must pass a sanitizer before it can render on a public site.» Instance: «`rich-text`'s `html` prop is a free string (`src/blocks/rich-text/schema.ts`) rendered via `dangerouslySetInnerHTML` (`component.tsx:9`); both the agent (`update_page`/`create_page`) and the Ask-AI propose path can write it. A chat instruction like "add this embed snippet" walks `<script>` straight onto a publishable page — validation checks shape, never content.» Fix-class: «sanitize `html` (allowlist) inside `validateBlocks` or at render; one gate covers agent, propose, and manual paths.»

- [D1110] (change events × Provenance→Consumption) — «What a tool did must survive to what the operator sees — for every tool, not just page writes.» Instance: «`AgentToolResult.change` is never persisted (only `data` is — `loop.ts:439-446`), and the live `onEvent` is unwired in production. `deriveChangeFromToolData` (`history.ts:31-53`) can only reconstruct `page_updated`/`page_created`; `template_applied`, `image_imported`, and `site_updated` cards vanish from every reloaded/tailed transcript.» Fix-class: «persist the `change` object alongside the tool message (embedded envelope or extra jsonb column) and render cards from it directly.»

- [D1111] (auto-continue × State-Visibility/Comprehension) — «Between-batch state must read as "continuing", and progress must be countable.» Instance: «the per-round note "Reached the limit of 30 tool calls for this turn; stopping here." (`loop.ts:479`) is persisted into the visible transcript of a build that then *silently continues* (auto-continue re-enqueues); nothing anywhere surfaces "batch 2 of 4" — the `continuation` counter lives only in the job payload.» Fix-class: «make the loop's note continuation-aware ("Continuing — batch N of M…") via a hint passed from `handleAgentTurn`, and show the batch counter in the tail.»

- [D1112] (budget × Cost/Gating-axis) — «Spend caps must exist on the axis spend actually scales on.» Instance: «`AI_AGENT_TOKEN_BUDGET` is per-conversation-per-day (`loop.ts:338-345`); N sites × 1 conversation each (or new conversations after archiving lands per D1104) multiply spend with no site-level or global ceiling — `docs/ai-agent.md:399-403` concedes there is no aggregate view.» Fix-class: «add a global (and/or per-site) daily token gate checked at claim time, summing `token_usage[today]` across conversations.»

- [D1113] (applyAndValidate/update_page × Contract-Stability) — «An edit to one block must not be hostage to every other block's current schema.» Instance: «`applyAndValidate` (`edit-ops.ts:176-188`) revalidates the *whole* resulting page against the live registry, and block schemas carry no version. A `@anchorcorps/components` schema tightening makes every legacy page un-editable by the agent (and by propose) — rejected at `validate` for blocks the op never touched.» Fix-class: «validate only touched/inserted blocks, or version block schemas with a migrate-on-read shim.»

- [D1114] (block catalog × Population/Dark) — «Every catalog entry the model can place must carry AI-usable guidance and its render preconditions.» Instance: «`crm_form` and `phone_number` are in the AI catalog with no `aiHints` and dev-facing descriptions ("PHI never touches the builder (D-006). Use embed_code from the CRM site detail", "CTM will swap the display number after mount") — the model can place a CRM form with no embed configured or a CTM-dependent phone block on a site without CTM, both rendering dead; `hero-slider`/`logo-reel`/`image` need media the model may not have imported yet.» Fix-class: «add `aiHints` (or an `aiExclude` flag) to precondition-bearing blocks; rewrite descriptions for the model as consumer.»

- [D1115] (conversation-create route × Precondition/Forward-path) — «A persisted user message must always have a path to a turn.» Instance: «`POST /sites/:siteId/agent/conversations` with `message` but `run` omitted (or `run:"inline"`) appends the user message and returns 201 without enqueueing anything (`admin-ai-agent.ts:305-323`) — a dead-letter message no job will ever answer; the next real send then stacks a second consecutive user turn on top of it.» Fix-class: «make any message-bearing create enqueue (drop the `run` distinction), or reject `message` without `run:"job"`.»

- [D1116] (delete_page × Reversibility) — «The agent's only irreversible tool must not be its cheapest.» Instance: «`delete_page` deletes the page row and — via `page_revisions.page_id ON DELETE CASCADE` (`db/migrations/1747571000000_sites_pages_revisions.cjs:94-99`) — every revision with it; unlike every write (revision-backed, revertible) a model misfire or injected "clean up the old pages" destroys content with no undo and no confirmation gate.» Fix-class: «soft-delete (status `deleted` + restore window) or require the operator to confirm agent-initiated deletes via the change card.»

- [D1117] (import_image × Provenance/Idempotence) — «An imported asset must remember where it came from, and importing twice must not duplicate.» Instance: «`ingestImageFromUrl` (`media/ingest.ts:239-250`) persists neither the source URL nor the photographer credit `search_stock_images` returned — attribution and provenance are unrecoverable — and there is no `(site_id, source_url)` dedupe, so a resumed/re-run build re-imports the same Pixabay hits as new assets.» Fix-class: «add `source_url`/`credit` columns on `media_assets` + dedupe-by-URL short-circuit in the tool.»

- [D1118] (chat client tail × Failure/Recovery) — «A dropped tail must reconnect; a build must not appear frozen while it keeps running.» Instance: «`startTail`'s `streamAgentEvents(...).catch(() => {})` (`useAgentConversation.ts:209-211`) treats any connection drop as terminal — no retry, no cursor-resume, no user-visible notice; the transcript silently freezes mid-build (heartbeats notwithstanding, proxies and laptop sleeps kill long SSE fetches routinely).» Fix-class: «auto-reconnect with backoff from `lastMessageIdRef` on non-abort termination.»

- [D1119] (turn lock × Reversibility/Safety) — «A stealable lock needs a fencing token.» Instance: «acknowledged-but-deferred in code (`admin-ai-agent.ts:203-210`) and doc: a worker that hung past the 10-minute stale-takeover window can later release the *newer* claimant's `running` back to `active`, letting two turns interleave writes and Anthropic history. Recorded as a directive so it stays scheduled work, not a comment.» Fix-class: «lease token column set on claim, compared on every release/append.»

- [D1120] (settings tools × Reversibility) — «Site-level agent mutations deserve the same undo trail page writes get.» Instance: «`set_brand_tokens` (a documented full REPLACE) and `set_seo_defaults` write `sites` directly with no revision/snapshot anywhere (`tools/settings.ts:36-47,70-88`) — the agent can wipe an operator's hand-tuned theme in one call and nothing can restore it; every page tool, by contrast, is revision-backed.» Fix-class: «snapshot prior `default_brand_tokens`/`seo_defaults` (site_revisions table or embedded history) + a revert card.»

## Notable passes (highest-risk cells verified clean)

- **Turn serialization & job dedup** (24/25/26 × I, G): atomic `claimConversationTurn`, stale takeover, `stately` + per-round singleton keys, release-before-enqueue ordering, and the null-send disambiguation are all correct and unit/integration-tested (`agent-turn.test.ts`, `loop.test.ts`).
- **SSRF defense on `import_image`** (21 × S): https-only, redirect-refusing, IPv4/IPv6-mapped/NAT64-aware host blocklist, 20MB streaming cap, 30s abort — thorough (`media/ingest.ts`).
- **Revert correctness** (13/14/18 × R): prior-revision (not after-state) revision ids on change events; create_page deliberately omits a Revert affordance. Locked, tie-broken, `clock_timestamp()`-ordered revision writes.
- **Error labeling** (22 × C): `describeAnthropicError` labels auth/billing/rate-limit/overload honestly and persists through the normal transcript channel; the failure-streak stop message is honest and actionable.
- **Doc integrity** (27): `docs/ai-agent.md` matches the code in every checked claim — tool table, caps, stately policy, resume semantics, stub behavior, dead paths (`onEvent`, `deadline`) explicitly flagged as dead.
- **Doc'd dead code is documented, not dark** (22/26 × PD): `run:"inline"` literal, `AgentTurnEvent`, `promoted` path — all called out in doc/comments as test-only/back-compat.
- **First-build stub path** (23): exercises the real create_page pipeline, honest about failure, zero spend.

## First-build narrative (what a one-line prompt actually produces)

Prompt-only: create site (no brand tokens when a prompt exists) → conversation seeded with the raw
prompt (`title: "Initial build"`, `run:"job"`) → job claims, loop runs with the 16-block catalog;
TEMPLATE-FIRST steers the model to `get_site_overview` → `apply_site_template` (9 seeded site
templates: dental, law, restaurant, fitness, coaching, nonprofit, retail, home-services, portfolio,
smb-landing) → adapt copy via `update_page` ops → optionally Pixabay search/import for imagery →
up to 4×30 tool calls. Theme comes only from the template's adopted tokens or a volunteered
`set_brand_tokens` call the prompt never asks for (D1100). Both-mode: template materializes first
(8s bounded wait, race per D1107), then the same conversation flow against the populated site.

---

**Census 30 units · 20 lenses · 600/600 cells (100%) · 21 directives (29 directive cells) · 489 passes · 82 n/a · 0 blank.**
