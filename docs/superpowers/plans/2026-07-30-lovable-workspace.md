# Lovable-Style Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Studio into a Lovable-style product: builds that finish, a full-screen chat+preview workspace, no Puck, and a 10-template polished gallery.

**Architecture:** Three phases. A rewires chat turns onto the existing pg-boss job path with auto-continue batching. B rebuilds the Studio shell around the existing chat components and preview iframe. C adds gallery metadata, ~11 new block types, a per-file template authoring format, and 10 templates.

**Tech Stack:** Existing: Express + pg-boss v12, React 18, Zod block registry, TipTap (already used by inline rich-text), esbuild overlay. No new runtime deps except none — MUI is design reference only.

**Spec:** `docs/superpowers/specs/2026-07-30-lovable-workspace-design.md`

## Global Constraints

- Block JSON (`pages.blocks` JSONB) stays the single source of truth; every new block registers in the one Zod registry driving renderer + AI catalog (`buildBlockCatalog()`) + editable markers + git sync.
- pg-boss v12: handlers are `async ([job])`; `createQueue` before `work`; **`singletonKey` requires `policy:"stately"` and drops duplicate keys** — continuation enqueues MUST vary the key per round.
- All writes go through `validateBlocks`/`applyAndValidate`; revisions append-only with free-text `source`.
- TypeScript ESM with `.js` import suffixes; tests colocated `*.test.ts(x)`; full suite must stay green per task.
- Cloud Run request timeout is 60s — no HTTP request may run an agent loop inline.
- `--set-env-vars`/`--set-secrets` in cloudbuild.yaml REPLACE their lists; any new env var must be added there, never manually.
- Commit after each task (operator's standing rule); one committing writer at a time.

---

## Phase A — agent runs that finish

### Task A1: `runAgentTurn` returns its end reason

**Files:**
- Modify: `src/server/ai/agent/loop.ts`
- Test: `src/server/ai/agent/loop.test.ts` (existing file, add cases)

**Interfaces:**
- Produces: `runAgentTurn(...): Promise<AgentTurnResult>` where
  `type AgentTurnResult = { endReason: "completed" | "tool_limit" | "deadline" | "token_budget" | "error"; toolCalls: number }`
  (exported from loop.ts). All existing callers compile — they currently ignore the return value.

- [ ] **Step 1:** Add failing tests: a turn that ends naturally resolves `{endReason:"completed"}`; a turn hitting `maxToolCalls` resolves `{endReason:"tool_limit", toolCalls: <cap>}`; deadline → `"deadline"`.
- [ ] **Step 2:** Thread the reason out of the two existing cap checks (`loop.ts:345`, `loop.ts:400`) and the natural-stop path into the return value. No behavior change otherwise.
- [ ] **Step 3:** Suite green. Commit `feat(agent): runAgentTurn returns end reason`.

### Task A2: chat messages route enqueues a job (kill the inline 15/45s path)

**Files:**
- Modify: `src/server/routes/admin-ai-agent.ts` (POST `/sites/:siteId/agent/conversations/:conversationId/messages`, currently streams inline with `limits:{maxToolCalls:15, deadlineMs:45_000}` at :439)
- Modify: `src/admin/components/AgentChatDrawer.tsx` (sendMessage path :400)
- Modify: `src/admin/lib/agent-api.ts`
- Test: route test file + `AgentChatDrawer.test.tsx`

**Interfaces:**
- POST messages request body unchanged (`{message: string}`); response becomes `202 {queued: true, conversation_id}` (no SSE body). 409 turn-lock behavior unchanged.
- Client after 202 calls the existing `startTail` (`GET …/events?after=`) — the same tail already used for wizard `run:"job"` turns; the DB-polling SSE is cross-instance safe.

- [ ] **Step 1:** Failing route test: POST message → 202, a pg-boss `AGENT_TURN` job enqueued (assert via boss spy/fake) with payload `{conversationId, siteId, continuation: 0}`, user row persisted, lock claimed. No `runAgentTurn` call in-request.
- [ ] **Step 2:** Implement: reuse the wizard's enqueue helper (`hasLiveAgentTurnJob` dedupe-202 logic stays). Delete the inline `runAgentTurn` invocation, its SSE writer, and the `limits:{15,45_000}` literal. Keep the tail route untouched.
- [ ] **Step 3:** Client: on 202, open/refresh the tail stream; remove the inline-stream code path from `agent-api.ts` (`streamAgentEvents` POST variant) and the drawer. Status strip driven by tail `status` events.
- [ ] **Step 4:** Suite green (route + drawer tests updated). Commit `feat(agent): all chat turns run as background jobs`.

### Task A3: auto-continue batching in the job handler

**Files:**
- Modify: `src/server/jobs/agent-turn.ts` (handler at :45), `src/server/jobs/index.ts` (payload type)
- Test: `src/server/jobs/agent-turn.test.ts`

**Interfaces:**
- Consumes: `AgentTurnResult` from A1.
- Job payload gains `continuation?: number` (default 0). `MAX_CONTINUATIONS = 3` (env `AI_AGENT_MAX_CONTINUATIONS`).
- **singletonKey for continuations must vary per round:** `` `${siteId}:c${continuation}` `` — stately policy would silently drop a re-enqueue under the bare siteId key while the finished job is still in retention.

- [ ] **Step 1:** Failing tests: handler whose `runAgentTurn` resolves `tool_limit` with `continuation:0` re-enqueues `{continuation:1}` under key `${siteId}:c1`; `continuation:3` does NOT re-enqueue and appends a visible assistant note ("paused after N batches — say continue"); `completed` never re-enqueues; turn-lock is re-claimed for each continuation and released on terminal end.
- [ ] **Step 2:** Implement. The continuation turn appends **no** new user row — the loop resumes from history (the model sees its own "reached the limit" note and continues). Release-lock-before-enqueue ordering preserved.
- [ ] **Step 3:** Suite green. Commit `feat(agent): auto-continue up to 3 batches per user message`.

### Task A4: label Anthropic API failures in chat

**Files:**
- Modify: `src/server/ai/agent/loop.ts` (the catch path that currently persists a generic error), `src/server/ai/agent/repo.ts` if a status column value is added
- Modify: `src/admin/components/agent-chat/*` (status rendering)
- Test: loop.test.ts + a drawer render test

**Interfaces:**
- On Anthropic SDK errors, persist an assistant-visible error row: 401/403 → "Anthropic API key rejected"; 400 with billing text → "Anthropic credit balance too low — top up at console.anthropic.com"; 429/529 → "Anthropic is rate-limiting/overloaded — retry shortly"; else generic. Conversation status set to `error` with that label, never bare "internal".

- [ ] **Step 1:** Failing tests mapping each error class to its label.
- [ ] **Step 2:** Implement mapping helper `describeAnthropicError(err): string` in loop.ts (exported for tests); UI shows the label in the amber status strip with the existing Resume affordance.
- [ ] **Step 3:** Suite green. Commit `feat(agent): surface Anthropic auth/billing/rate errors`.

**Phase A gate:** deploy to prod, run a real site build end-to-end (throwaway slug), confirm one visible run with ≥2 auto-continuations and no manual "continue".

---

## Phase B — the workspace

### Task B1: extract the preview panel

**Files:**
- Create: `src/admin/components/SitePreviewPanel.tsx` (move `DraftPreview` from `SiteDetailPage.tsx:272-509` verbatim; props unchanged: `{siteId, previewPageId, previewNonce, agentBusy}`)
- Modify: `src/admin/pages/SiteDetailPage.tsx` (import it)
- Test: move/point existing DraftPreview tests

- [ ] Move component + tests, no behavior change, suite green. Commit `refactor(studio): extract SitePreviewPanel`.

### Task B2: workspace page at `/sites/:slug`, legacy tabs to `/sites/:slug/manage`

**Files:**
- Create: `src/admin/pages/WorkspacePage.tsx`
- Modify: `src/admin/AdminApp.tsx` (routes), `src/admin/pages/SiteDetailPage.tsx` (now served at `/manage`; drawer/DraftPreview mounting removed from it), nav links in `PagesTab/BlogTab/EventsTab` untouched
- Test: `WorkspacePage.test.tsx`, `AdminApp.test.tsx`

**Interfaces:**
- Layout: CSS grid `380px 1fr`; left = chat panel built from `agent-chat/*` components directly (chatReducer, ToolSteps, Composer, Markdown) — the Drawer wrapper is not reused; right = `SitePreviewPanel`.
- Top bar: site display name; page switcher (`GET /api/sites/:siteId/pages`, sets `previewPageId`); viewport toggle (desktop = 100%, mobile = 390px centered frame); Edit toggle + Publish button (B3); link to `/sites/:slug/manage`; GitHub deep link when `site_git_state.enabled`.
- `?ai=1` auto-focuses the composer (replaces the drawer auto-open behavior).

- [ ] **Step 1:** Failing route tests: `/sites/:slug` renders WorkspacePage; `/sites/:slug/manage` renders the legacy tabs.
- [ ] **Step 2:** Build WorkspacePage; conversation bootstrap identical to the drawer's (list → newest active or create).
- [ ] **Step 3:** Suite green. Commit `feat(studio): Lovable-style workspace shell`.

### Task B3: publish from the top bar

**Files:**
- Create: server route `POST /api/sites/:siteId/publish` in `src/server/routes/admin-pages.ts` (publishes every draft page: same save+revision path, `source:'manual'`, preserving each page's current blocks/seo; returns `{published: n, live_url}` where live_url = primary domain)
- Modify: `WorkspacePage.tsx` (button + confirmation popover showing page count + live URL after)
- Test: route test + workspace test

- [ ] **Step 1:** Failing route test: two drafts → 200 `{published:2}`, both rows `status='published'`, revisions appended; idempotent second call `{published:0}`.
- [ ] **Step 2:** Implement server + UI (button disabled while `agentBusy`).
- [ ] **Step 3:** Suite green. Commit `feat(studio): one-click publish`.

### Task B4: new-site screen — prompt + template gallery

**Files:**
- Rewrite: `src/admin/pages/NewSiteWizard.tsx` → `src/admin/pages/NewSitePage.tsx`
- Modify: `AdminApp.tsx` route `/sites/new`
- Test: `NewSitePage.test.tsx`

**Interfaces:**
- Hero prompt textarea ("What do you want to build?") + optional template card grid (`GET /api/templates?kind=site`, cards use C1's `category`/`cover_image_url`; "Blank" card last; slug/name auto-derived, editable in a collapsible row).
- Submit: template picked → `POST /api/sites/from-template` then create conversation with the prompt (`run:"job"`); no template → existing blank-site + conversation flow. Both navigate to `/sites/:slug?ai=1` (workspace).
- Keep the `waitForPages` poll before navigating on the template path.

- [ ] **Step 1:** Failing tests for both submit paths + gallery render from a stubbed template list.
- [ ] **Step 2:** Implement; delete the old wizard.
- [ ] **Step 3:** Suite green. Commit `feat(studio): Lovable-style new-site screen`.

### Task B5: remove Puck; TipTap body editor for posts/events

**Files:**
- Delete: `src/editor/**` (incl. `__tests__`), `src/admin/pages/EditorPage.tsx` (+test)
- Rewrite: `src/admin/components/BlockBodyEditor.tsx` — TipTap editor (same extension set as the inline rich-text overlay) reading/writing a single `richText` block; if the body has non-richText blocks, render a read-only "AI-managed layout — edit via workspace chat" panel with a link instead of destroying them
- Modify: `AdminApp.tsx` (drop `/sites/:slug/pages/:pageId` route; `PagesTab.tsx:298` navigates to `/sites/:slug?page=<id>` i.e. the workspace with that page previewed), `PostEditorPage.tsx`/`EventEditorPage.tsx` (new BlockBodyEditor), `package.json` (drop `@measured/puck`), test stubs in `AdminApp.test.tsx` etc.
- Test: `BlockBodyEditor.test.tsx` rewrite

- [ ] **Step 1:** Failing tests: BlockBodyEditor round-trips `[{type:"richText",…}]`; mixed-blocks body shows the read-only panel; deleted route redirects.
- [ ] **Step 2:** Implement; `npm ls @measured/puck` empty; grep proves no `src/editor` imports remain.
- [ ] **Step 3:** Full suite green. Commit `feat(studio)!: remove Puck visual builder`.

**Phase B gate:** operator walkthrough of the workspace before Phase C UI-facing work.

---

## Phase C — template library

### Task C1: gallery metadata

**Files:**
- Create: migration `db/migrations/<ts>_template_gallery.cjs` — `templates` gains `category text`, `cover_image_url text`, `sort_order int not null default 0`
- Modify: `src/server/routes/templates.ts` (list returns new fields, ordered by `sort_order`), `src/server/templates/repo.ts`, `db/seed-templates.ts` (starter gets category "Basic", sort 999)
- Test: repo/route tests

- [ ] Migration + plumbing + tests green. Commit `feat(templates): gallery metadata`.

### Task C2: block expansion, batch 1 (structure)

**Files:** `packages/components/src/` + `src/blocks/registry` per existing pattern (schema, renderer, editable markers, editable-fields classification, catalog snapshot tests)

New blocks, each with Zod schema + renderer + `data-ac-edit` markers + tests:
`splitHero` (image left/right, eyebrow/heading/body/CTAs), `featureGrid` (icon+title+body ×3-6), `statsBand`, `richFooter` (multi-column links + social + hours), `navBar` variants (prop `variant: "default"|"centered"|"cta"`), `announcementBar`.

- [ ] One commit per block (registry snapshot + renderer + editable tests). Components package version bump once at batch end.

### Task C3: block expansion, batch 2 (content)

Same pattern: `pricingTable`, `teamGrid`, `imageGallery` (masonry + lightbox-free grid), `testimonialWall`, `contactSplit` (form + hours/map-embed url).

- [ ] One commit per block; version bump; full suite green.

### Task C4: template authoring harness

**Files:**
- Create: `db/templates/types.ts` (`TemplateSeed` with pages, brand_tokens, category, cover: `{stockQuery|url, alt}`), `db/templates/index.ts` (registry array)
- Modify: `db/seed-templates.ts` — iterate the registry; ingest each cover through the existing media pipeline at seed time (skip when already ingested; hash by URL), keep UPSERT-by-slug idempotence; starter moves to `db/templates/starter.ts`

- [ ] Harness + starter migration + seed test green. Commit `feat(templates): per-file template authoring`.

### Tasks C5–C14: ten templates (parallelizable after C2-C4)

One task per template — slugs: `dental-practice`, `home-services`, `restaurant`, `law-firm`, `fitness-studio`, `creative-portfolio`, `coaching`, `nonprofit`, `local-retail`, `smb-landing`.

Each task's definition of done:
- [ ] 4-6 pages of complete, category-appropriate copy structure (no lorem), built from registry blocks (`validateBlocks` passes in the seed test)
- [ ] Coherent `brand_tokens` palette + typography; curated stock cover + in-page imagery via stock queries
- [ ] Design ported from a named free reference (MUI marketing / Tailwind free / HTML5UP — cite in the file header comment)
- [ ] Renders clean at desktop + 390px mobile in the workspace preview (reviewer checks via preview route)
- [ ] Commit `feat(templates): <slug>`

**Phase C gate:** seed to prod, gallery review with the operator.

---

## Execution notes

- superpowers:subagent-driven-development; controller as overseer/fact-checker; pipelined implementers with one committing writer at a time; C5-C14 may run as parallel isolated worktrees (content-only files, no conflicts).
- Phase A ships to prod immediately on completion (it fixes the operator's active pain); B and C ship at their gates.
- Env additions (`AI_AGENT_MAX_CONTINUATIONS` if non-default) go into cloudbuild.yaml in the same task that introduces them.
