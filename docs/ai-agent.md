# AI site agent (persistent, site-scoped, multi-turn)

The site agent gives the platform its "Lovable" moment: describe a business in
chat and the agent assembles a multi-page draft site from existing blocks and
templates, then keeps iterating in the same conversation. It's the second
generation of the AI layer — Phase 6's `docs/ai-editing.md` (single-shot,
per-page, edit-only) is untouched and still powers the "Ask AI" panel; this
system adds a persistent chat that can create pages, apply templates, import
stock imagery, and edit blocks across a whole site over many turns.

Spec: `docs/superpowers/specs/2026-07-27-ai-site-agent-design.md`. Plan:
`docs/superpowers/plans/2026-07-27-ai-site-agent.md` (Tasks 1–14).

## Architecture summary

New module `src/server/ai/agent/` beside the existing Phase 6 code
(`src/server/ai/{config,client,catalog,edit-ops,diff,propose}.ts`), which it
reuses rather than duplicates: the pinned model (`AI_MODEL` in `config.ts`),
`resolveAiMode()`, the non-streaming `runMessage()` SDK wrapper, the block
catalog, and the edit-op applier/validator all come from Phase 6.

- **No sidecar service, no Agent SDK** — the loop is a hand-rolled tool-use
  loop on `@anthropic-ai/sdk`, living in the existing Express deployable
  (Architecture A from the spec).
- **Every conversation is scoped to one `site_id`.** Site creation isn't a
  special case: "Start with AI" creates a draft site first, then opens a
  conversation against it — the agent always operates on a real site with
  real revisions from turn one.
- **Auto-apply to draft.** The agent writes directly to draft pages; every
  write is a `page_revisions` row (`source: 'ai'`), so it's always
  revertible through the existing restore endpoint. Publishing stays a
  manual operator action and is deliberately **not** an agent tool.
  (The inline click-to-edit overlay writes through the same table with
  `source: 'inline'` — see `docs/inline-editing.md`; a validated GitHub push
  writes `source: 'git:<sha7>'` — see `docs/github-sync.md`.)
- **Data model** — two tables (`db/migrations/1747601000000_ai_agent.cjs`,
  `status` extended with `'running'` by
  `db/migrations/1747602000000_ai_agent_running_status.cjs` — see "Turn
  serialization" below):
  - `ai_conversations` — `id, site_id (FK CASCADE), title, status
    ('active'|'error'|'archived'|'running'), token_usage jsonb, created_at,
    updated_at`.
  - `ai_messages` — `id, conversation_id (FK CASCADE), role
    ('user'|'assistant'|'tool'), content jsonb, created_at`. `content` stores
    the raw Anthropic content-block array so `tool_use`/`tool_result` replay
    losslessly when the loop rebuilds model context from the DB.
- Repo functions (`src/server/ai/agent/repo.ts`): `createConversation`,
  `getConversation` (site-scoped — returns `null` across tenants),
  `listConversations`, `appendMessage`, `listMessages`,
  `setConversationStatus`, `claimConversationTurn` / `releaseConversationTurn`
  (the turn-serialization lock — see "Turn serialization" below),
  `addTokenUsage`, `getTodayUsage`. All pool-first, mirroring
  `src/server/blog/repo.ts`.

## Tool belt

Every tool wraps an existing primitive; every block write goes through the
same validator the manual save endpoint uses (`src/blocks/validate.ts`,
D-039 via `applyAndValidate`). Every tool rejects ids outside the
conversation's `site_id` (cross-tenant guard, unit-tested per tool). Tool
contract: `src/server/ai/agent/tools/types.ts` (`AgentTool`, `AgentToolCtx`,
`AgentToolResult`, `AgentChangeEvent`). Registry + dispatcher + Anthropic
`Tool[]` builder: `src/server/ai/agent/tools/index.ts`.

| Tool | File | Params (Zod) | Wraps / effect |
|---|---|---|---|
| `get_site_overview` | `tools/read.ts` | `{}` | Site row (slug, display name, status, brand tokens, SEO defaults) + pages (`updated_at` DESC) + media count + active templates. |
| `get_page` | `tools/read.ts` | `{ page_id: uuid }` | Full page (blocks + `seo`), site-scoped; miss → `ok:false`. |
| `list_templates` | `tools/read.ts` | `{ kind?: "site"\|"page" }` | Active templates, optionally filtered by kind. |
| `list_media` | `tools/read.ts` | `{}` | Site's media assets (id, alt, content_type, variants_status), newest 100. |
| `create_page` | `tools/pages.ts` | `{ slug, title, blocks?: [{type,props}] }` | Assigns block ids, `validateBlocks`, inserts `pages` (status `draft`) + a `page_revisions` row (`source:'ai'`) in one transaction. Duplicate slug → `ok:false "slug already in use"`. |
| `update_page` | `tools/pages.ts` | `{ page_id, title?, ops: editOpsSchema }` | Loads the page site-scoped, runs Phase 6's `applyAndValidate` (insert/update/delete/move ops), writes new blocks + a revision (existing `seo` carried over) in one transaction. Failure returns `ok:false` with the failing stage/details so the model can self-correct. |
| `delete_page` | `tools/pages.ts` | `{ page_id }` | `SELECT ... FOR UPDATE` over the site's pages (closes a TOCTOU on the "last page" guard), then deletes. Refuses to delete a site's only page. |
| `set_brand_tokens` | `tools/settings.ts` | `{ tokens: brandTokensSchema }` | REPLACES `sites.default_brand_tokens` wholesale (unlike `set_seo_defaults` below), then `evictSiteCacheForSite` (covers explicit `site_domains` rows AND the canonical subdomain fallback). |
| `set_seo_defaults` | `tools/settings.ts` | `{ seo_defaults: siteSeoDefaultsSchema }` | Shallow-merges the input over the site's CURRENT `seo_defaults` (a partial update no longer drops fields it didn't mention), writes, then cache eviction. |
| `set_page_seo` | `tools/settings.ts` | `{ page_id, seo: seoFieldsSchema }` | Site-scoped `UPDATE pages.seo` + a `page_revisions` row (blocks unchanged, new `seo`). |
| `apply_site_template` | `tools/assets.ts` | `{ template_id: uuid }` | Loads the template (must be `kind:'site'`, `status:'active'`), refuses if the site already has pages, then calls `handleMaterializeTemplate` **directly** (synchronous — the agent needs pages to exist before its next tool call; the operator-initiated `/sites/from-template` route enqueues the same handler as a pg-boss job instead). |
| `search_stock_images` | `tools/assets.ts` | `{ query, per_page?: 1-20 (default 9) }` | `searchPixabay()` (`src/server/media/pixabay.ts`); no side effects. Stub mode (no `PIXABAY_API_KEY`) returns 3 deterministic `example.invalid` hits. |
| `import_image` | `tools/assets.ts` | `{ url, alt: min 3 chars }` | Downloads the URL and lands it in the standard media pipeline (`ingestImageFromUrl`, `src/server/media/ingest.ts`: asset row → GCS original → `media.process-upload` job) — alt text is **required** at import (spec decision). `example.invalid` hosts (Pixabay stub hits) short-circuit to a canned in-memory 1×1 PNG so stub builds stay fully offline. |

Deliberately not tools: publish, domain provisioning, plugin enable/config,
CRM/CTM, anything secret-touching.

`AgentChangeEvent` (`{ kind, page_id?, revision_id?, summary }`) is a tool's
`AgentToolResult.change`, but only `result.data` is what actually gets
persisted in the `tool` message's content block — the DB has no column for
the live `change` object. The Studio chat transcript
(`src/admin/components/agent-chat/history.ts`'s `deriveChangeFromToolData`)
best-effort-reconstructs a change card from that persisted `data` (page_id +
revision_id + a diff summary, or "Page created") as it tails the
conversation, so a change card can always link to the page and, when a
`revision_id` is present, offer Revert — it just isn't a faithful replay of
the original tool result.

## Turn lifecycle

**Status:** the loop (`src/server/ai/agent/loop.ts`, `runAgentTurn`, Task 8),
the `ai.agent-turn` pg-boss job (`src/server/jobs/agent-turn.ts`,
`handleAgentTurn`, Task 9), and the HTTP layer that exposes them to the
browser (`src/server/routes/admin-ai-agent.ts`, Task 10 — conversation CRUD,
the message-POST routes, and the job-tail SSE route) are all implemented and
tested (`tests/integration/ai-agent-routes.test.ts`), and mounted in
`createApp` (`src/server/app.ts`) alongside the other `/api` routers. The
Studio chat UI that calls it (`src/admin/pages/WorkspacePage.tsx` +
`src/admin/components/agent-chat/`, `src/admin/lib/agent-api.ts`) is built
against the contract below, including the draft-preview endpoint
(`GET /api/sites/:siteId/pages/:pageId/preview`, added to
`src/server/routes/admin-pages.ts`) that the preview panel's iframe consumes.

**Every turn is a background job — there is no in-request turn anymore.**
Task A2 (2026-07-30 lovable-workspace SDD) deleted the inline HTTP turn path
entirely: Cloud Run's 60s request timeout means no HTTP request may run an
agent loop in-process (see `global-constraints.md`), so every turn — the
wizard's initial build, a follow-up chat message, a Resume — follows the
same one path:

1. `POST .../conversations/:id/messages` (or `POST .../conversations` with
   `run:"job"` for a brand-new conversation) claims the conversation's turn
   lock, appends the user message, enqueues an `AGENT_TURN` pg-boss job, and
   responds **`202 { queued: true, job_id, user_message_id, ... }`**
   immediately — no SSE, no streamed tokens, nothing left open on this
   request. There is no `run:"inline"` path; the zod schema on
   `POST .../conversations` still accepts the literal for backward
   compatibility, but nothing in this codebase ever sends it — the client
   (`NewSitePage.tsx`) always sends `run:"job"`.
2. The client immediately opens `GET .../conversations/:id/events?after=<user_message_id>`
   — a DB-polling SSE tail (`streamAgentEvents` in `agent-api.ts`), **not**
   a live stream off the running turn. The route polls `ai_messages`/
   `ai_conversations` once a second and re-emits new rows as `AgentTailEvent`s
   (`snapshot` / `message` / `status`; see "SSE event types" below) plus a
   15s heartbeat comment.
3. `handleAgentTurn` (the pg-boss worker) claims the same turn lock, calls
   `runAgentTurn` with **no `limits`** — full `AI_AGENT_MAX_TOOL_CALLS`
   (default 30), no wall-clock deadline — and lets it run to one of its
   terminal `endReason`s (see "Caps inside a turn" below). Progress is
   whatever `runAgentTurn` persists to `ai_messages` as it goes; the loop's
   internal `onEvent` callback (still typed as `AgentTurnEvent` inside
   `loop.ts`) is never wired to anything in production — the job passes no
   `onEvent`, so it's a no-op. The tail only ever sees the DB rows.
4. **Auto-continue.** If the turn ends `tool_limit` (it hit
   `AI_AGENT_MAX_TOOL_CALLS` mid-task, not actually done), `handleAgentTurn`
   re-enqueues the NEXT batch itself — no new user message needed, the
   model's own "reached the limit" note (persisted by `loop.ts`) is already
   the last row in history, so the continuation job just resumes from it.
   The job payload carries a `continuation` counter starting at `0` for the
   very first job; each `tool_limit` re-enqueues `continuation + 1` as long
   as the CURRENT `continuation < AI_AGENT_MAX_CONTINUATIONS` (default `3`)
   — so the initial job plus up to `AI_AGENT_MAX_CONTINUATIONS` re-enqueues
   gives **`AI_AGENT_MAX_CONTINUATIONS + 1` batches total** per user message
   (4 at the defaults), each capable of up to `AI_AGENT_MAX_TOOL_CALLS` tool
   calls — up to `(AI_AGENT_MAX_CONTINUATIONS + 1) × AI_AGENT_MAX_TOOL_CALLS`
   tool calls (120 at the defaults) before the agent gives up on its own.
   Each round's job carries a round-scoped pg-boss `singletonKey`
   (`buildContinuationSingletonKey`: `` `${conversationId}:c${continuation}` ``)
   so `stately`-policy dedup can't collide across rounds.
5. **At the cap** (`continuation >= AI_AGENT_MAX_CONTINUATIONS`),
   `handleAgentTurn` appends one more, clearly user-facing assistant message
   — **`"Paused after N batches — send a message to continue."`** — and
   releases the conversation back to `active` instead of re-enqueuing. The
   operator sends any new message (or hits Resume) to pick the build back up;
   context rebuild always resumes cleanly (see "Resume semantics" below).

**Turn serialization.** A conversation can only have ONE turn in flight at a
time — a second `POST .../messages` or `POST .../conversations` (`run:"job"`,
message given) while another turn is already running would otherwise
interleave invalid Anthropic history and conflicting mutations (e.g. the
composer being enabled while the chat panel is still tailing a job-run
build). Enforced via a DB-level lock, `status:'running'`,
claimed atomically (`claimConversationTurn`, `src/server/ai/agent/repo.ts`)
before a turn starts and released (`releaseConversationTurn`) when it ends:

- **Claiming** succeeds from `status:'active'` or `status:'error'` (the
  normal "nothing running" states), or from a `status:'running'` row whose
  `updated_at` is more than **10 minutes** stale (a takeover for a turn that
  crashed without releasing — `appendMessage` bumps `updated_at` on every
  persisted message, so a genuinely active turn keeps re-arming this window
  well under 10 minutes; the claim itself also bumps `updated_at`, so a job
  that sits queued for a while before pg-boss dequeues it doesn't start the
  clock early).
- **A failed claim returns `409 { error: "turn already running" }`** on both
  message-POST routes and on conversation-create-with-job. The Studio chat
  panel renders this as a system line ("A build is already running — wait
  for it to finish.") and re-enables the composer.
- **Who holds the lock, and for how long:** the two enqueuing routes
  (`runJobTurn` in `admin-ai-agent.ts`) claim, append the seed message, then
  RELEASE before calling `enqueue()` — ownership of the long-lived hold
  passes to the `ai.agent-turn` job handler (`src/server/jobs/agent-turn.ts`),
  which claims again at entry and holds it for the turn's full (potentially
  long) execution, releasing (conditionally — only if still `running`, so an
  already-`error`'d turn isn't clobbered back to `active`) once the turn ends
  (or hands off to the next auto-continue round — see "Auto-continue" above).
  This release-before-enqueue ordering matters: releasing before enqueueing
  (rather than after, the original round-1 shape) closes a gap where a
  worker fast enough to dequeue-and-claim in
  between `send()` and the route's post-enqueue release would lose its own
  claim attempt against the route's still-held lock, while pg-boss marked
  the delivery complete anyway — the build would silently never run.
- **Job dedup:** the `ai.agent-turn` pg-boss queue uses the `stately` policy
  (`src/server/jobs/index.ts` — pg-boss's default `standard` policy does
  NOT enforce `singletonKey` at all) plus `retryLimit: 0`, so a second
  `send()` for a conversation that already has one queued/active job
  returns `null` instead of enqueueing a duplicate (a turn's tool calls
  commit real side effects as they go, so a pg-boss auto-retry would be
  unsafe). Because `null` is now ambiguous — it also means "the queue is
  down" (`getBoss()` threw) — the routes disambiguate via
  `hasLiveAgentTurnJob` (a direct, defensive read of pg-boss's own
  `pgboss.job` table for a `created`/`active`/`retry` row with this
  conversation's id as `singleton_key`; pg-boss has no per-key "already
  queued?" query in its public API): a genuine dedupe responds
  `202 { queued: true, deduped: true }`, otherwise `503 { error: "job queue
  unavailable" }`.
- **Deferred (recorded, not implemented):** the claim has no owner-fencing
  token. A worker whose claim was itself invalidated by a stale-takeover
  (it hung past the 10-minute window and another delivery took over) could
  still run to completion and release, incorrectly flipping the NEWER
  claim's `running` back to `active` before that turn finishes. Low
  probability; closing it fully needs a lease token threaded through
  claim/release.

**Resume semantics.** Two distinct paths pick a conversation back up, and
both lean on the same context-rebuild guarantee:

- **Auto-continue** (see above) — a `tool_limit`-ended round's last
  persisted message is always the role-`tool` message from its
  just-finished batch of tool calls; `handleAgentTurn`'s re-enqueued job
  resumes from exactly that, automatically, with no user action.
- **Manual Resume** — a conversation in `status:'error'` (a 3-in-a-row tool
  failure streak, or a labeled Anthropic API error — see "Labeled Anthropic
  errors" below; token-budget exhaustion does NOT set `status:'error'`, it
  just ends the turn) shows a **Resume** button in the Composer
  (`resumeVisible={conversation?.status === "error"}` in
  `WorkspacePage.tsx`) that sends the literal `"continue"` user message
  through the normal message-POST path — same job, same lock, same
  `202`/tail flow as any other message.

Both rely on `buildApiMessages()` rebuilding model context straight from
`ai_messages` (DB `user`/`assistant` map 1:1 to API roles; DB `tool` rides
inside an API `user`-role message, per the Anthropic messages convention —
there is no API `tool` role), so the rebuilt context always ends in either
`tool_result`s (auto-continue) or the fresh `"continue"` user message
(manual Resume), and the model picks the task back up mid-stream with no
special-casing. No partial-write cleanup is needed anywhere because every
mutation is one atomic validated save + revision.

Note: `runAgentTurn`'s `reason:"promoted"` / mid-turn `deadline` code path
still exists (see the `limits` parameter's doc comment in `loop.ts`) and is
exercised directly by `loop.test.ts`, but no production caller passes a
`deadlineMs` anymore — it's dead in practice, kept only for the unit-test
surface.

**Caps inside a turn** (`runAgentTurn`):
- **Tool-call cap** — cumulative tool calls ≥ `maxToolCalls` → persists a
  short note, `turn_done` reason `max_tools`. In production this is what
  triggers auto-continue (see above), not a dead end.
- **Failure streak** — 3 consecutive `ok:false` results from the *same* tool
  name (a different tool succeeding doesn't reset another tool's streak) →
  persists an explanation, sets the conversation `status:'error'`,
  `turn_done` reason `error`.
- **Anthropic API error** — the model call itself throws (auth/billing/
  rate-limit/overload) → `describeAnthropicError()` maps it to a short,
  human-readable label (see "Labeled Anthropic errors" below), persists it,
  sets the conversation `status:'error'`, `turn_done` reason `error`.
- **Budget gate** — checked before every model call (see "Budget and cap
  knobs" below); does not set `status:'error'`.
- **Deadline** — `turn_done` reason `promoted`; dead in production (see
  "Resume semantics" above), exercised only by `loop.test.ts` passing
  `limits.deadlineMs` directly.

**Labeled Anthropic errors.** `describeAnthropicError()`
(`src/server/ai/agent/loop.ts`) duck-types on a thrown error's `status`/
`message` (so a plain injected test error is handled identically to a real
SDK exception) and maps it to one of four human-readable strings instead of
the bare amber "internal" the operator used to see:
- `401`/`403` → `"Anthropic API key rejected"`
- `400` + `/billing|credit/i` in the message → `"Anthropic credit balance
  too low — top up at console.anthropic.com"`
- `429` → `"Anthropic is rate-limiting — retry shortly"`
- `529` or `/overloaded/i` in the message → `"Anthropic is overloaded —
  retry shortly"`
- anything else → `"The site agent hit an unexpected error and stopped."`

The label is persisted as an assistant message (so it renders in the
transcript like any other agent text) and the conversation flips to
`status:'error'`, which surfaces the **Resume** button described above.

## SSE event types

**There is exactly one SSE producer in production**: the job-tail route
(`GET .../conversations/:id/events?after=<messageId>`, `admin-ai-agent.ts`).
It never observes a live, in-progress turn — it polls `ai_messages`/
`ai_conversations` roughly once a second and re-emits new rows as
`AgentTailEvent`s (`src/admin/lib/agent-api.ts`):

| Event | Shape | When |
|---|---|---|
| `snapshot` | `{ type, conversation, messages }` | Sent once on connect: the conversation row + the message backlog (`?after=` cursor if given, else the last 50 rows). |
| `message` | `{ type, message }` | One per newly-persisted `ai_messages` row, polled (interval ~1s) since the last-seen id. |
| `status` | `{ type, status }` | Whenever the conversation's `status` changes (e.g. `active` → `error`). |

It also sends a bare `: hb\n\n` heartbeat comment every 15s to keep the
connection alive through proxies; the client (`streamAgentEvents()` in
`src/admin/lib/agent-api.ts`) skips lines starting with `:`.

`AgentTurnEvent` (`{ assistant_text | tool_call | tool_result | turn_done }`)
still exists as a type inside `loop.ts` — `runAgentTurn` still calls its
`onEvent` callback at every one of these points internally — but no
production caller ever passes an `onEvent` (`handleAgentTurn` calls
`runAgentTurn({pool, conversationId, siteId})` with nothing else), so it
defaults to a no-op and these events go nowhere. They exist purely for
`loop.test.ts`'s direct unit coverage of the loop. Don't confuse them with
the tail's `AgentTailEvent`s above — the client only ever sees the latter.

## Budget and cap knobs

Both optional, read via `env` (falls back to `process.env`) inside
`runAgentTurn`; also documented in `.env.example`:

- **`AI_AGENT_TOKEN_BUDGET`** (default `1000000`) — max combined input+output
  tokens per conversation **per day**. Checked before every model call
  against `ai_conversations.token_usage[<today>]`; on exhaustion the agent
  stops gracefully between tool calls (never mid-write) with a message
  telling the operator to wait or raise the budget, and `turn_done` reason
  `budget`.
- **`AI_AGENT_MAX_TOOL_CALLS`** (default `30`) — hard cap on tool calls in a
  single job batch. Hitting it ends that batch with `turn_done` reason
  `max_tools`; `handleAgentTurn` auto-continues into a fresh batch (see
  "Auto-continue" above) rather than stopping the build.
- **`AI_AGENT_MAX_CONTINUATIONS`** (default `3`) — cap on auto-continue
  rounds per user message, read by `handleAgentTurn`
  (`src/server/jobs/agent-turn.ts`), not `runAgentTurn` itself. Combined
  with `AI_AGENT_MAX_TOOL_CALLS`, one user message can drive up to
  `(AI_AGENT_MAX_CONTINUATIONS + 1) × AI_AGENT_MAX_TOOL_CALLS` tool calls
  (120 at the defaults) before the agent pauses and asks the operator to
  send another message.

Both `parsePositiveIntEnv`'d — an empty/non-numeric/non-positive-integer
value falls back to the default rather than silently becoming `0` or `NaN`
(`Number("")` is `0`, not `NaN`, so a naive `Number(env.X)` would otherwise
let a blank env var zero out the cap or budget).

Token usage accrues via `addTokenUsage(pool, conversationId, { input,
output }, day)` after every model call, keyed by UTC day
(`YYYY-MM-DD`, `new Date().toISOString().slice(0,10)` by default).

## Stub-mode behavior

Mode selection is Phase 6's `resolveAiMode()` (`src/server/ai/config.ts`),
reused as-is: no `ANTHROPIC_API_KEY` → `stub`; `=== "dry-run"` → `dry-run`;
anything else → `api`. `runAgentTurn` treats stub and dry-run identically —
whenever mode `!== "api"` it runs a **deterministic script** through the
real tool path (not a mock):

- Site has no pages → calls the real `create_page` tool with a `hero` +
  `rich-text` block (copy explicitly flags "[AI agent stub]"), persists a
  synthetic `tool_use`/`tool_result` message pair, emits the matching
  `tool_call`/`tool_result` events, then a final assistant text — "Stub
  mode: created a starter Home page."
- Site already has pages → just a final assistant text — "Stub mode: no
  changes made — site already has pages."
- Either way, `turn_done` reason `end_turn`. Zero API spend, fully
  deterministic — this is what CI and the local dev default exercise
  (`tests/integration/ai-agent-build.test.ts`).

`PIXABAY_API_KEY` unset behaves the same way independently: `searchPixabay()`
returns 3 fixed `example.invalid` hits, and `import_image` special-cases
`example.invalid` hosts with a canned in-memory 1×1 PNG so a stub build can
"import" a stock photo without any network access or GCS credentials.

## Operator runbook

**Provisioning secrets** (Cloud Run project `anchor-hub-480305`,
`--set-secrets` in `cloudbuild.yaml` — remember this flag **replaces the
whole secret list on every deploy**, so any name removed from it is dropped
from the next revision):

- `ANTHROPIC_API_KEY` and `PIXABAY_API_KEY` already existed in Secret Manager
  before this feature — they were simply never wired into
  `--set-secrets`, so prod ran the AI layer in stub mode with a real key
  sitting unused. This work added both names to the list.
- `PLUGIN_CONFIG_ENC_KEY` did not exist and was created as part of this
  work, with `roles/secretmanager.secretAccessor` granted to the Cloud Run
  runtime service account (mirroring how `GODADDY_API_KEY` is bound — see
  `docs/security.md`). **The key MUST be base64**, not hex: generate it with
  `openssl rand -base64 32` and sanity-check it decodes to exactly 32 bytes
  (`node -e 'console.log(Buffer.from(process.argv[1],"base64").length)' "$KEY"`
  → `32`) before uploading — `src/server/plugins/crypto.ts`'s `resolveKey()`
  does `Buffer.from(raw, "base64")` and requires exactly 32 decoded bytes
  (also documented at `docs/plugins.md:76-77`); a hex-encoded 32-byte string
  base64-decodes to 48 bytes and throws the first time a key-bearing plugin
  secret is touched. The secret's first version was created with the wrong
  (hex) encoding and was superseded: version 2 (base64, verified 32 bytes) is
  the enabled version `:latest` resolves to; version 1 was disabled, not
  deleted. See the Task 14 report for the exact commands run.
- To rotate any of the three: create a new secret **version** (`gcloud
  secrets versions add <NAME> --data-file=-`); `:latest` in the
  `--set-secrets` list picks it up on the next deploy without a
  `cloudbuild.yaml` change.

**Watching cost.** `ai_conversations.token_usage` is a `jsonb` map of
`{ "<YYYY-MM-DD>": { input, output } }` per conversation — sum across active
conversations for a rough daily spend signal, or query the max/day to spot a
conversation approaching `AI_AGENT_TOKEN_BUDGET`. There's no cross-site
aggregate view yet; this is per-conversation only.

**Conversation `error` status.** A conversation flips to `status:'error'`
when a tool fails 3 times in a row (self-correction exhausted) or a build-turn
job throws (`handleAgentTurn` catches, sets `error`, then rethrows so pg-boss
records the failure). Nothing needs cleanup — every mutation the agent makes
is one atomic validated save + revision, so there's no partial state to
unwind. The Studio chat panel's Composer surfaces a **Resume** button on an
`error` conversation that sends a plain `"continue"` user message; because
context rebuild always ends in the last persisted `tool_result`s (see
Resume semantics above), the model picks up where it left off.
