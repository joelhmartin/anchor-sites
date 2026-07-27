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
- **Data model** — two tables (`db/migrations/1747601000000_ai_agent.cjs`):
  - `ai_conversations` — `id, site_id (FK CASCADE), title, status
    ('active'|'error'|'archived'), token_usage jsonb, created_at, updated_at`.
  - `ai_messages` — `id, conversation_id (FK CASCADE), role
    ('user'|'assistant'|'tool'), content jsonb, created_at`. `content` stores
    the raw Anthropic content-block array so `tool_use`/`tool_result` replay
    losslessly when the loop rebuilds model context from the DB.
- Repo functions (`src/server/ai/agent/repo.ts`): `createConversation`,
  `getConversation` (site-scoped — returns `null` across tenants),
  `listConversations`, `appendMessage`, `listMessages`,
  `setConversationStatus`, `addTokenUsage`, `getTodayUsage`. All pool-first,
  mirroring `src/server/blog/repo.ts`.

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
| `set_brand_tokens` | `tools/settings.ts` | `{ tokens: brandTokensSchema }` | `UPDATE sites.default_brand_tokens`, then `evictSiteCacheForSite` (covers explicit `site_domains` rows AND the canonical subdomain fallback). |
| `set_seo_defaults` | `tools/settings.ts` | `{ seo_defaults: siteSeoDefaultsSchema }` | `UPDATE sites.seo_defaults` + cache eviction. |
| `set_page_seo` | `tools/settings.ts` | `{ page_id, seo: seoFieldsSchema }` | Site-scoped `UPDATE pages.seo` + a `page_revisions` row (blocks unchanged, new `seo`). |
| `apply_site_template` | `tools/assets.ts` | `{ template_id: uuid }` | Loads the template (must be `kind:'site'`, `status:'active'`), refuses if the site already has pages, then calls `handleMaterializeTemplate` **directly** (synchronous — the agent needs pages to exist before its next tool call; the operator-initiated `/sites/from-template` route enqueues the same handler as a pg-boss job instead). |
| `search_stock_images` | `tools/assets.ts` | `{ query, per_page?: 1-20 (default 9) }` | `searchPixabay()` (`src/server/media/pixabay.ts`); no side effects. Stub mode (no `PIXABAY_API_KEY`) returns 3 deterministic `example.invalid` hits. |
| `import_image` | `tools/assets.ts` | `{ url, alt: min 3 chars }` | Downloads the URL and lands it in the standard media pipeline (`ingestImageFromUrl`, `src/server/media/ingest.ts`: asset row → GCS original → `media.process-upload` job) — alt text is **required** at import (spec decision). `example.invalid` hosts (Pixabay stub hits) short-circuit to a canned in-memory 1×1 PNG so stub builds stay fully offline. |

Deliberately not tools: publish, domain provisioning, plugin enable/config,
CRM/CTM, anything secret-touching.

`AgentChangeEvent` (`{ kind, page_id?, revision_id?, summary }`) flows
unchanged from a tool's `AgentToolResult.change` → the loop's `tool_result`
event → the SSE stream → the drawer's change cards, so a UI change card can
always link to the page and, when a `revision_id` is present, offer Revert.

## Turn lifecycle

**Status:** the loop (`src/server/ai/agent/loop.ts`, `runAgentTurn`, Task 8),
the `ai.agent-turn` pg-boss job (`src/server/jobs/agent-turn.ts`,
`handleAgentTurn`, Task 9), and the HTTP layer that exposes them to the
browser (`src/server/routes/admin-ai-agent.ts`, Task 10 — conversation CRUD,
the inline SSE message route, and the job-tail SSE route) are all implemented
and tested (`tests/integration/ai-agent-routes.test.ts`), and mounted in
`createApp` (`src/server/app.ts`) alongside the other `/api` routers. The
admin UI that calls it (`AgentChatDrawer`, `agent-api.ts`, Tasks 11–12) was
built against the contract below ahead of Task 10 landing; the routes now
match it, including the draft-preview endpoint
(`GET /api/sites/:siteId/pages/:pageId/preview`, added to
`src/server/routes/admin-pages.ts`) that Task 12's preview iframe consumes.

Two execution paths by turn weight, per the spec:

- **Chat turns** (edits, questions) run in-request and stream to the browser
  over SSE.
- **Build turns** (initial build, multi-page work) run the same loop inside a
  pg-boss job (`ai.agent-turn`), appending progress to `ai_messages`; the
  chat drawer tails the conversation over SSE backed by the DB. This survives
  Cloud Run's 60s request timeout and mid-build deploys.
- **Routing rule:** turns from the "Start with AI" wizard always run as jobs
  (`POST .../conversations` with `run:"job"`). Drawer turns run in-request
  and are **auto-promoted** to a continuation job when a turn exceeds **45s
  elapsed or 15 tool calls** — the inline route passes
  `limits: { maxToolCalls: 15, deadlineMs: 45_000 }` into `runAgentTurn`; the
  job path passes no limits, so it falls back to the env-configured caps
  (`AI_AGENT_MAX_TOOL_CALLS`, no deadline).

**Resume semantics.** When the deadline is hit, the loop returns
`{ reason: "promoted" }` **without persisting anything extra** — the last
persisted message is always the role-`tool` message from the just-finished
round of tool calls. `buildApiMessages()` rebuilds model context straight
from `ai_messages` (DB `user`/`assistant` map 1:1 to API roles; DB `tool`
rides inside an API `user`-role message, per the Anthropic messages
convention — there is no API `tool` role). So a continuation call — whether
the route's post-promotion `enqueue()` or an operator hitting **Resume** on
an `error` conversation — always rebuilds a context that ends in
`tool_result`s, and the model picks the task back up mid-stream with no
special-casing. A conversation in `status:'error'` (e.g. from a failure
streak) accepts a new user message as a manually-triggered resume; no
partial-write cleanup is needed anywhere because every mutation is one
atomic validated save + revision.

**Caps inside a turn** (`runAgentTurn`):
- **Tool-call cap** — cumulative tool calls ≥ `maxToolCalls` → persists a
  short note, `turn_done` reason `max_tools`.
- **Failure streak** — 3 consecutive `ok:false` results from the *same* tool
  name (a different tool succeeding doesn't reset another tool's streak) →
  persists an explanation, sets the conversation `status:'error'`,
  `turn_done` reason `error`.
- **Budget gate** — checked before every model call (see below).
- **Deadline** — `turn_done` reason `promoted` (route only; the job path has
  no deadline).

## SSE event types

Loop-level events (`AgentTurnEvent`, emitted via the `onEvent` callback
passed into `runAgentTurn`, and the shape the inline-turn route streams as
SSE `data:` frames):

| Event | Shape | When |
|---|---|---|
| `assistant_text` | `{ type, text }` | Once per `text` content block in an assistant message (including the stub script's final summary). |
| `tool_call` | `{ type, name, input }` | Just before a tool executes. |
| `tool_result` | `{ type, name, ok, summary?, change? }` | Just after a tool executes; `change` carries the `AgentChangeEvent` on success. |
| `turn_done` | `{ type, reason, message? }` | Once per turn; `reason` is one of `end_turn \| max_tools \| budget \| error \| promoted`. |

Tail events (`AgentTailEvent`, from `GET .../conversations/:id/events?after=<messageId>`
— the SSE endpoint a job-run build is followed on):

| Event | Shape | When |
|---|---|---|
| `snapshot` | `{ type, conversation, messages }` | Sent once on connect: the conversation row + the message backlog (after `after` if given, else the last 50). |
| `message` | `{ type, message }` | One per newly-persisted `ai_messages` row, polled (interval ~1s) since the last-seen id. |
| `status` | `{ type, status }` | Whenever the conversation's `status` changes (e.g. `active` → `error`). |

Both channels also send a bare `: hb\n\n` heartbeat comment periodically to
keep the connection alive through proxies; clients (`streamAgentEvents()` in
`src/admin/lib/agent-api.ts`) skip lines starting with `:`. Per the plan's
Global Constraints, v1 streams at **event granularity**, not token deltas —
`runMessage()` is non-streaming by type — but the protocol is shaped to add
deltas later without breaking clients.

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
  single turn (the inline route additionally caps at 15 before promoting).

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
unwind. The drawer surfaces a **Resume** action on an `error` conversation
that sends a plain `"continue"` user message; because context rebuild always
ends in the last persisted `tool_result`s (see Resume semantics above), the
model picks up where it left off.
