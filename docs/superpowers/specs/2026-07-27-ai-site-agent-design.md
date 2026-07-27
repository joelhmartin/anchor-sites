# AI Site Agent — Design Spec

**Date:** 2026-07-27
**Status:** Approved (operator, in-chat)
**Sub-project 1 of 3** in the "Lovable for websites" evolution. Sub-project 2 (inline
on-page editing) and 3 (GitHub site sync) get their own specs later.

## Purpose

Give the platform its Lovable moment: describe a business in chat, the agent assembles a
full multi-page draft site from existing blocks and templates, and you keep iterating in
the same conversation. Today's AI (Phase 6) is single-shot, per-page, edit-only; this
upgrades it to a persistent, site-scoped, multi-turn agent.

## Decisions locked during brainstorming

1. **Build on the existing platform** — the block registry (D-001/D-002) already drives
   renderer + Puck fields + AI catalog from one source. No ground-up rewrite.
2. **Full site agent** — one persistent chat per site; can create the site, manage pages,
   edit blocks, set brand tokens, SEO, and nav. The creation wizard is just the first
   conversation.
3. **Auto-apply to draft** — the agent executes directly against draft pages; every write
   is a `page_revisions` entry (rollback exists already). Publishing stays a manual
   operator action and is **not** an agent tool.
4. **Sonnet + template-first** — pinned Sonnet (current `src/server/ai/config.ts`
   pattern), prompt caching on system + block catalog. Builds compose from templates and
   registered blocks, then rewrite copy — never invent structure from nothing.
5. **Stock images via Pixabay** — an agent tool searches Pixabay and imports selected
   images through the existing GCS media pipeline (signed-URL upload → sharp variants →
   `asset_id`). Agent writes alt text at import.
6. **Architecture A: in-service agent loop** — no sidecar service, no Agent SDK. The loop
   lives in the existing Express deployable.

## Architecture

New module `src/server/ai/agent/` beside the existing Phase 6 code. Phase 6's
`propose.ts` / `ai-edit` endpoint / AskAiPanel are untouched and keep working.

Every conversation is scoped to one `site_id`. Site creation is not a special case:
the Studio "Start with AI" path immediately creates a draft site (auto slug, no domain),
then opens a conversation against it. The agent always operates on a real site; every
write lands in real tables with real revisions from turn one.

### Data model

Two new tables (node-pg-migrate, following existing conventions):

- `ai_conversations` — `id uuid PK, site_id uuid FK (CASCADE), title text,
  status text CHECK ('active'|'error'|'archived') DEFAULT 'active',
  token_usage jsonb DEFAULT '{}', created_at, updated_at`
- `ai_messages` — `id uuid PK, conversation_id uuid FK (CASCADE),
  role text CHECK ('user'|'assistant'|'tool'), content jsonb NOT NULL, created_at`
  — `content` stores raw Anthropic content blocks so tool_use/tool_result replay
  losslessly when rebuilding context.

Page writes reuse `page_revisions` with `source:'ai'`. No new revision machinery.

### Tool belt

Every tool wraps an existing primitive; every block write goes through the shared
validator (`src/blocks/validate.ts`, D-039). All tools must reject IDs outside the
conversation's `site_id` (cross-tenant guard, unit-tested per tool).

| Tool | Wraps |
|---|---|
| `get_site_overview` | pages list + brand tokens + SEO defaults + enabled plugins |
| `get_page` | page blocks + SEO |
| `create_page` / `delete_page` | pages repo; revision on write |
| `update_page` | Phase 6 edit ops (`insert/update/delete/move_block`) applied as a validated batch |
| `set_brand_tokens` | brand-token schema (D-029) |
| `set_seo_defaults` / `set_page_seo` | Phase 9 `seoFieldsSchema` / `sites.seo_defaults` |
| `list_templates` / `apply_site_template` | templates API + `template.materialize` job (template-first build path) |
| `search_stock_images` | Pixabay API (new thin client, keyed by `PIXABAY_API_KEY`) |
| `import_image` | download → existing GCS signed-URL upload → variant job → `asset_id`; alt text supplied by agent |
| `list_media` | site media library |

**Deliberately not tools:** publish, domain provisioning, plugin enable/config, CRM/CTM,
anything secret-touching.

The block catalog (`buildBlockCatalog()`) rides in the cached system prompt as today.

### Agent loop

Hand-rolled tool-use loop on the existing `@anthropic-ai/sdk`, preserving the
stub / dry-run / api mode switch so no key = no spend, and CI runs deterministic.

Two execution paths by turn weight:

- **Chat turns** (edits, questions): run in-request; streamed to the browser over SSE
  (text deltas + tool events).
- **Build turns** (initial build, multi-page work): the same loop runs inside a pg-boss
  job (`ai.agent-turn`), appending progress to `ai_messages`; the chat panel tails the
  conversation over SSE backed by the DB. Survives Cloud Run's 60s request timeout and
  mid-build deploys. Routing rule: turns initiated from the "Start with AI" wizard always
  run as jobs; drawer turns run in-request and are auto-promoted to a continuation job
  when a turn exceeds 45s elapsed or 15 tool calls (safe because conversation state
  lives in the DB, so the job resumes from the last persisted message).

Validation failures return to the model as tool_result errors so it self-corrects —
max 3 retries per tool call. Hard cap 30 tool calls per turn. Context window: last ~40
messages; conversation summarization is explicitly deferred.

### Studio UI

- **Chat drawer** on the site detail page (tabs remain usable beside it).
- **"Start with AI"** path in the New Site wizard → creates draft site → opens drawer.
- **Live preview iframe** of the draft page currently being touched, refreshed on each
  applied revision.
- Each applied change renders a compact card in-chat ("Updated *Home*: 3 blocks changed —
  view diff / revert"); revert wires to existing revision restore.
- Token usage (from `ai_conversations.token_usage`) shown in the drawer footer.

### Guardrails & error handling

- Extends the existing AI rate limiter (Phase 6/12).
- Per-conversation daily token budget, env-configurable; on exhaustion the agent stops
  gracefully between tool calls ("budget reached"), never mid-write.
- Crashed job → conversation `status:'error'` + resume button. No partial-write cleanup
  needed: every mutation is one atomic validated save + revision.
- Errors from tools are surfaced to the model (bounded), then to the operator in-chat.

### Testing

Follows Phase 6 patterns:

- Unit tests per tool wrapper: validation, revision write, **cross-site ID rejection**.
- Loop tests against a scripted fake Anthropic client — deterministic tool-call
  sequences, including validation-failure→retry and budget-exhaustion scripts.
- One integration test: full stub-mode site build against the test DB (Postgres :5434).
- jsdom tests for the chat drawer.
- Pixabay client tested against fixtures; no live API in CI.

### Ops prerequisites

- Add `ANTHROPIC_API_KEY` and `PIXABAY_API_KEY` to the `--set-secrets` list in
  `cloudbuild.yaml` (AI is currently stubbed in prod because the key was never listed).
- **Also add `PLUGIN_CONFIG_ENC_KEY`**, which is missing from that list today — same
  secret-replacement failure class that caused the earlier OAuth outage. All three land
  in one change.

## Out of scope (this sub-project)

- Inline on-page editing (sub-project 2).
- GitHub site sync / export / import (sub-project 3).
- Conversation summarization / long-memory.
- Agent-driven publish, domains, plugins, CRM.
- AI editing for posts/events bodies (pages only, as today).
- Tenant visitor-auth HTTP mount (known Phase 8 gap — tracked separately, not blocking
  this work).

## Definition of done

1. From Studio, "Start with AI" + a one-paragraph business description yields a
   multi-page draft site (real copy, imported stock imagery, brand tokens, SEO defaults)
   with no manual steps.
2. Follow-up chat messages modify the same site conversationally, each change revisioned
   and revertible from the chat card.
3. A validation-invalid block can never persist (proven by tests).
4. Stub mode: the full loop runs deterministically in CI with zero API spend.
5. Prod deploy carries the three secrets; a live build on a real prompt completes under
   the configured budget.
