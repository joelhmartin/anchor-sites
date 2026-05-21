# Phase 6 — AI editing layer (Claude API, schema-validated edits)

> **Goal:** Let an operator edit a page with natural language — "make the hero
> punchier", "add a testimonial section", "change the CTA to "Book a call"" —
> and have Claude propose **schema-validated** changes to the canonical
> `Block[]` (D-001), which the operator previews and applies through the
> existing save + revision API. The AI mutates *our* `Block[]`, never Puck's
> data; it never invents block types or props the registry doesn't know.

> **This file is PRE-DRAFTED (2026-05-20) so the next run starts with context,
> but UNLIKE Phase 5 the task list is NOT pre-approved.** Phase 6 adds a paid
> external dependency (Anthropic API), a new secret, and non-obvious API-shape
> choices (tool-use vs. structured output, propose-vs-apply). So the routine
> SHOULD run the normal **expand + confirm gate**: review/adjust the tasks
> below with the operator before writing code. Reorder or split freely.

## Anchors that govern this phase (do not violate)

- **D-001** — `Block[]` (`{ id, type, props, children? }`, `pages.blocks` JSONB) is the canonical shape the AI mutates. Not Puck's `{ content, root, zones }`.
- **D-002 / Zod-first** — every block's Zod schema is the contract. `zod-to-json-schema` turns the registry into the AI's block catalog; `aiHints` on each registry entry steer the model. The AI's output is **re-validated against the same Zod schemas server-side** before it can be saved.
- **D-017** — the AI editor does NOT import Puck. It produces `Block[]`; the visual editor reloads the converted data on apply (the 5.x `toPuckData` reload path). AI and visual edits converge on the same storage with no coupling (see `docs/visual-editor.md` "How AI editing stays decoupled").
- **Existing save/revision API (Phase 4/5)** — applying an accepted AI proposal saves via `POST /api/sites/:siteId/pages/:pageId` with **`source: "ai"`** (the column already exists; `docs/data-model.md`). No new save path; AI just feeds validated `Block[]` into it. Revisions/restore (5.9) cover undo.
- **Hard rules** — secrets in Secret Manager, not committed (#8 — `ANTHROPIC_API_KEY` is a new secret → operator prereq below). Never push red; CI auto-deploys prod on every push to `main` (D-035), so keep `main` green. UI can't be browser-verified here — unit-test with the Anthropic client + `fetch` mocked and Puck stubbed (the D-036 Puck-in-jsdom gotcha applies); flag visual QA for the operator at `studio.localhost:3000`.

## Use the `claude-api` skill

The Claude Code `claude-api` skill MUST be used when building the AI service
(6.1, 6.3, 6.4, 6.7). It covers the current Anthropic SDK, model selection,
**prompt caching** (cache the system prompt + block catalog — they're stable),
tool use, and structured output. Default to a current Claude model (Sonnet 4.6
is the cost/latency sweet spot for this; Opus for hard reasoning if needed —
confirm in the expansion). Knowledge cutoff: latest family is Claude 4.x.

## Operator prerequisites (before 6.4 can run for real)

- **Provision `ANTHROPIC_API_KEY`** in GCP Secret Manager and wire it to the
  `anchor-sites` Cloud Run service env (same pattern as the other secrets).
  Until then, the AI service runs in **dry-run/stub mode** (deterministic
  canned proposal) so dev + tests never call the live API and never spend money.
  Cannot be created via the routine — raise/track like the D-034 OAuth prereq.

## Decisions to record during execution

- **D-0xx — Anthropic SDK + model pin.** Pin `@anthropic-ai/sdk` (current `0.97.1`) and the Claude model id; record both. Dry-run mode contract when the key is absent (mirror the email `send.ts` stub/dry-run/api modes, D-012).
- **D-0xx — Edit contract.** Tool-use (`insert_block`/`update_block`/`delete_block`/`move_block`) vs. a single structured `Block[]` proposal. Record the chosen shape and why; freeze how invalid output is rejected.
- **D-0xx — Propose-then-apply.** The AI endpoint returns a *preview* (validated proposed `Block[]` + a human diff); it does NOT auto-save. Apply is an explicit operator action → save with `source:"ai"`.

## Tasks (PROPOSAL — confirm before coding)

### Foundation

- [x] **6.1 — Add & pin Anthropic SDK; AI service scaffold + config**
  - Add `@anthropic-ai/sdk` (pin exact; record the version + model). Create `src/server/ai/` with a client wrapper that reads `ANTHROPIC_API_KEY` from env and has **stub / dry-run / api modes** (mirror `src/server/email/send.ts`, D-012) so no key = no spend. No endpoint yet.
  - **Tests:** mode selection (stub when no key; dry-run returns a canned proposal; api builds the right request — client mocked). Build/typecheck clean.

- [x] **6.2 — Block catalog from the registry (`zod-to-json-schema`)**
  - Turn `listBlocks()` into the AI's catalog: per block `{ type, label, description, aiHints, jsonSchema }` via `zod-to-json-schema` (the helper foretold in `src/blocks/registry.ts`). This is the stable prefix that gets prompt-cached (6.7).
  - **Tests:** catalog includes every registered block + its `aiHints`; each `jsonSchema` is valid and round-trips a default-props instance.

### Edit contract + endpoint

- [x] **6.3 — Schema-validated edit-operations contract**
  - Define the mutation set the model emits and an applier that turns ops → a new `Block[]`. Re-validate every resulting block against the registry (extract/reuse `validateBlocks` from `src/server/routes/admin-pages.ts` so server + AI share one validator). Decide tool-use vs. structured output (record D-0xx). Unknown type / invalid props → rejected, never applied.
  - **Tests:** each op (insert/update/delete/move) applied to a `Block[]` yields the expected `Block[]`; invalid op or unregistered type is rejected; ids preserved/generated correctly.

- [x] **6.4 — AI-edit endpoint (preview, no auto-save)**
  - `POST /api/sites/:siteId/pages/:pageId/ai-edit` (admin-gated, rate-limited): body = NL instruction (+ optional target/selection). Loads current blocks, calls Claude with the catalog (6.2) + instruction via the edit contract (6.3), validates the proposal, returns `{ proposed_blocks, diff }`. **Does not save.** Dry-run returns a deterministic stub proposal.
  - **Tests (Anthropic client mocked):** returns validated proposed blocks; AI output with an unregistered/invalid block is rejected (never persisted); 401 without token; 400 on bad input.

- [x] **6.5 — Apply an accepted proposal**
  - Applying saves the proposed `Block[]` via the existing `POST …/pages/:pageId` with `source:"ai"` (+ a `page_revisions` row). Mostly wiring; confirm `source='ai'` lands in the revision.
  - **Tests:** applying persists the blocks with `source:'ai'` and writes a revision.

### Editor integration

- [ ] **6.6 — "Ask AI" panel in the editor**
  - An AI affordance in `src/admin` (the Puck editor route): instruction box → `ai-edit` → show the proposed change (diff/summary) → **Apply** reloads the editor (`Block[]` → `toPuckData`, the 5.x reload path) → **Reject** discards. Does NOT import Puck (D-017) — it produces `Block[]`; the editor re-renders.
  - **Tests (jsdom; AI client + `fetch` mocked, Puck stubbed):** instruction → preview renders; Apply triggers the save + editor reload; error surfaced.

### Hardening + wrap

- [ ] **6.7 — Prompt caching, guardrails, cost (`claude-api` skill)**
  - Cache the system prompt + block catalog (stable prefix). Cap max tokens; rate-limit AI calls. Enforce guardrails: the model can only reference registered block types; all props re-validated server-side; reject + surface otherwise. Record token/cost notes.
  - **Tests:** cache structure present on the request; guardrail rejects an unknown block type from a (mocked) model response.

- [ ] **6.8 — Phase 6 docs + plan tick**
  - `docs/ai-editing.md` (the `Block[]` mutation surface, catalog/prompt, edit-op contract + tool-use, the endpoint, the editor panel, model/secret config, reuse of save+revisions, how it stays decoupled from Puck). Record the SDK/model + edit-contract + propose-vs-apply decisions in `DECISIONS.md`. Tick the `PLAN.md` Phase 6 row. Append `.routine/baseline-tests.log`.

## Demo milestones (chat-only — surface in chat, do NOT email)

- AI proposes a valid block change for a real page (after 6.4).
- An AI proposal applied + saved with `source:'ai'`, visible in the revisions panel (after 6.5).
- "Ask AI" panel edits a page end-to-end and the editor reloads with the change (after 6.6).
- Phase 6 complete (after 6.8).

## Definition of done

- An operator can describe a change in the editor and Claude returns a **schema-valid** `Block[]` proposal; applying it saves through the existing API with `source:'ai'` + a revision; rejecting discards it.
- The AI can NEVER persist a block type or props the registry/Zod schemas don't accept (server-side re-validation is the gate).
- `Block[]` stays the source of truth; nothing in Phase 6 imports Puck; the prod renderer is unchanged.
- Prompt is cached; AI calls are rate-limited; no key = dry-run (no spend).
- Full suite green; new tests for the catalog, edit-op applier/validator, the endpoint (client mocked), apply+revision, and the editor panel. Visual QA is operator-run — flagged, not claimed.
- `PLAN.md` Phase 6 row ticked. Phase 7 not started — wait for `.routine/NEXT-PHASE-APPROVED`.

## Completion log

<!-- Routine appends entries below this line, newest first -->

### 2026-05-20 21:50 UTC — Task 6.5
**Commit:** <pending — recorded in follow-up chore commit>
**Done:** Apply path = the **existing** `POST …/pages/:pageId` save endpoint called with `source:"ai"` — no new server code (it already re-validates via the shared validator and writes a `page_revisions` row). Recorded **D-040** (propose-then-apply: preview never saves; apply reuses save). End-to-end test proves the full cycle: ai-edit preview → save `proposed_blocks` with `source:"ai"` → page updated + revision `source='ai'` → revisions list surfaces it.
**Tests added:** 1 (`ai-edit.test.ts` apply case). Fully isolated on a dedicated throwaway page created in `beforeAll` and dropped in `afterAll` (CASCADE) so the seeded muldoon home stays pristine — `page-render.test.ts` still green.
**Next:** 6.6 — "Ask AI" panel in the editor
**Notes:** D-040 documents preview-never-saves + apply-reuses-save (one validation + one revision mechanism, `source` tags AI edits for audit, undo = restore a revision). Full cold suite **389 / 58 files** green. Demo milestone (chat-only): an AI proposal applied with `source:'ai'`, visible in the revisions panel.

### 2026-05-20 21:46 UTC — Task 6.4
**Commit:** 1dd1d69
**Done:** `POST /api/sites/:siteId/pages/:pageId/ai-edit` (admin-gated, rate-limited) — **preview only, never saves** (the handler only SELECTs). `src/server/ai/propose.ts` (`proposeEdit`: builds system prompt + block catalog + the 4 edit tools from the op param schemas, calls Claude via `runMessage`, parses `tool_use` → `EditOp[]`, runs `applyAndValidate`, returns `{ proposed_blocks, diff, message }`); stub/dry-run return a deterministic rich-text sample (no spend). `src/server/ai/diff.ts` (`diffBlocks`: added/removed/updated/moved with relative-order move detection so inserts don't false-flag survivors). `edit-ops.ts` refactored to export per-op **param** schemas (the tool `input_schema` source, with `op` stripped — the tool name carries it).
**Tests added:** 18 — `diff.test.ts` (6); `propose.test.ts` (8, Anthropic client mocked: valid ops → proposal + diff; tools + catalog sent in the request; unknown-type / invalid-props → `validate` reject; malformed tool input → `bad_tool_input`; text-only → no-op); `ai-edit.test.ts` (4 integration: 401 / 400 / 404 + 200 dry-run returns proposal + diff and the stored page is unchanged). Save-route suite (19) still green.
**Next:** 6.5 — apply an accepted proposal (save with `source:'ai'` + revision)
**Notes:** "Never persisted" is structural (no write path in the handler) **and** asserted in the integration test. Real model proposals need the operator's `ANTHROPIC_API_KEY`; dry-run exercises the full apply→validate→diff pipeline. Full cold suite **388 / 58 files** green. Demo milestone (chat-only): AI-edit endpoint proposes a schema-valid change for a real page.

### 2026-05-20 21:38 UTC — Task 6.3
**Commit:** 11cd9d8
**Done:** Edit-op contract + applier + shared validator. Extracted `blockShape` + `validateBlocks` from `admin-pages.ts` into `src/blocks/validate.ts` (save route now imports it — behavior unchanged). `src/server/ai/edit-ops.ts`: Zod discriminated union (`insert_block`/`update_block`/`delete_block`/`move_block`, `place` enum default `end`), pure `applyEditOps` (structuredClone, fail-fast on `missing_id`/`bad_placement`, nanoid ids for new blocks), and `applyAndValidate` (apply → `validateBlocks` guardrail; unknown type / invalid props / missing id rejected, never applied).
**Tests added:** 14 (`src/server/ai/edit-ops.test.ts`) — contract defaults + unknown-op rejection, each op, start/end/after placement, purity, missing-id + bad-placement, and `applyAndValidate` accept / unknown-type / invalid-props / apply-stage. Save-route suite (19 tests) re-run green — the extraction is behavior-preserving.
**Next:** 6.4 — AI-edit endpoint (preview, no auto-save)
**Notes:** D-039 records the tool-use-ops contract + the single shared validator. Full cold suite **370 / 55 files** green.

### 2026-05-20 21:32 UTC — Task 6.2
**Commit:** e0a01f9
**Done:** `src/server/ai/catalog.ts` — `buildBlockCatalog()` turns `listBlocks()` into `{ type, label, description, aiHints?, category, jsonSchema }`, deriving each `jsonSchema` from the block's Zod schema via `zod-to-json-schema` (`$refStrategy:"none"` → inlined draft-07, no `$ref` for the model to resolve). Order = registration order so the serialized catalog is byte-stable (prompt-cache requirement for 6.7). Plugin blocks (D-016) appear automatically.
**Tests added:** 4 (`src/server/ai/catalog.test.ts` — every registered block present; label/description/category/aiHints sourced from the registry; each `jsonSchema` is a valid object schema whose `properties` cover the default-props instance + a true zod round-trip; byte-stable determinism). Order-independent via the `beforeEach` reset + re-register pattern (mirrors `puck-config.test.ts`).
**Next:** 6.3 — schema-validated edit-op contract + applier + shared `validateBlocks`
**Notes:** No new decision. Full cold suite **356 / 54 files** green.

### 2026-05-20 21:16 UTC — Task 6.1
**Commit:** 1deca54
**Done:** Pinned `@anthropic-ai/sdk@0.97.1` (exact). Added `src/server/ai/config.ts` (model pin `claude-sonnet-4-6`, `AI_MAX_TOKENS`, `resolveAiMode`) + `src/server/ai/client.ts` (`runMessage` with stub/dry-run/api modes mirroring `send.ts`; injectable client; model pin forced, non-overridable). No endpoint yet.
**Tests added:** 8 (`src/server/ai/client.test.ts` — `resolveAiMode` ×3; `runMessage` modes ×5, incl. no-spend in stub/dry-run + pinned-model/raisable-max_tokens in api with the client mocked).
**Next:** 6.2 — block catalog from the registry via `zod-to-json-schema`
**Notes:** D-038 records SDK + model pin + the three modes + wrapper shape. Typecheck clean; full cold suite **352 / 53 files** green (was 344/52). SDK import does NOT break cold collection (the D-036 dep-scan risk did not materialize — tests inject a fake client and never load the real SDK).
