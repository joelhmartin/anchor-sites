# AI editing layer (Phase 6 — Claude API, schema-validated edits)

The AI editor lets an operator change a page in natural language — "make the
hero punchier", "add a testimonial section", "remove the logo reel" — and have
Claude propose **schema-validated** changes to the canonical `Block[]` (D-001),
which the operator previews and applies through the existing save + revision
API. The AI mutates *our* `Block[]`, never Puck's data; it can never invent a
block type or props the registry rejects.

Decisions: **D-038** (SDK + model pin + modes), **D-039** (tool-use edit
contract + one shared validator), **D-040** (propose-then-apply). Builds on
**D-001** (`Block[]` is canonical), **D-002** (Zod is the contract), **D-017**
(the AI does not import Puck).

## The boundary: `Block[]` is the source of truth

Everything operates on `Block[]` (`{ id, type, props, children? }`, `pages.blocks`
JSONB). The AI never imports Puck and never sees Puck's `Data` shape. It reads
the current `Block[]`, proposes a new `Block[]`, and the editor reloads it
(`toPuckData`, the 5.x reload path). AI edits and visual edits converge on the
same storage with no coupling (see `docs/visual-editor.md` → "How AI editing
stays decoupled").

## Pieces (all under `src/server/ai/`)

| File | Role |
|---|---|
| `config.ts` | Model pin `AI_MODEL = "claude-sonnet-4-6"`, `AI_MAX_TOKENS = 4096`, `resolveAiMode()`. |
| `client.ts` | `runMessage()` — thin SDK wrapper. Owns the pin (model not overridable); stub/dry-run/api modes; injectable client for tests. |
| `catalog.ts` | `buildBlockCatalog()` — the registry → `{ type, label, description, aiHints?, category, jsonSchema }[]` (via `zod-to-json-schema`). Deterministic (prompt-cache stable). |
| `edit-ops.ts` | The edit-op contract (Zod), `applyEditOps` (pure applier), `applyAndValidate` (apply → re-validate guardrail). |
| `diff.ts` | `diffBlocks(before, after)` — added/removed/updated/moved + summary for the preview. |
| `propose.ts` | `proposeEdit()` — orchestrates: build prompt + tools, call Claude, parse `tool_use` → ops, `applyAndValidate`, diff. |

The save/validation surface lives in `src/blocks/validate.ts` (`validateBlocks`,
shared with the save route) and the endpoint + Ask-AI panel reuse the Phase-4/5
save + revision API.

## Model + secret config (D-038)

- **Model:** `claude-sonnet-4-6`, pinned in `config.ts`. Operator's cost/latency
  call; bumping to Opus 4.7 is a one-line change (the contract is model-agnostic).
- **SDK:** `@anthropic-ai/sdk` pinned exact `0.97.1`.
- **Modes** (mirror `src/server/email/send.ts`): `ANTHROPIC_API_KEY` unset →
  `stub`; `=== "dry-run"` → `dry-run`; any other value → `api`. Stub/dry-run
  return a deterministic sample proposal (a rich-text block) so dev + tests never
  call the live API and never spend.
- **Operator prerequisite (gates live edits):** provision `ANTHROPIC_API_KEY` in
  GCP Secret Manager and wire it to the `anchor-sites` Cloud Run env (same pattern
  as `MAILGUN_*`). Until then prod runs `stub` (no spend). Like the D-034 OAuth
  prereq, this can't be done by the routine.

## The edit-op contract (D-039)

Claude expresses edits as **tool-use ops** (not a whole-array rewrite):

| Tool | Params | Effect |
|---|---|---|
| `insert_block` | `block:{type,props}`, `place:"start"\|"end"\|"after"`, `after_id?` | Insert a new block. `block.type` is constrained to the registered-types enum. |
| `update_block` | `id`, `props` | **Shallow-merge** `props` over the block's current props. |
| `delete_block` | `id` | Remove the block (and its subtree). |
| `move_block` | `id`, `place`, `after_id?` | Reposition an existing block. |

`applyEditOps(blocks, ops)` is **pure** (clones via `structuredClone`, never
mutates input), applies ops in order, and **stops at the first failure**
(`missing_id` / `bad_placement`). New blocks get a `nanoid` id; existing ids are
preserved. v1 ops operate on the **top-level** array (current blocks are all leaf
blocks — D-036); nested-children mutation is deferred.

### The guardrail

`applyAndValidate(blocks, ops)` runs the applier **then** `validateBlocks` (the
same validator the manual save endpoint uses, `src/blocks/validate.ts`):
unknown type → `unknown_type`, bad props → `invalid_props`. Either stage failing
rejects the **whole** proposal — it never yields `blocks`. So the AI can never
produce a `Block[]` the save path would refuse. The tool `type` enum steers the
model; **server-side re-validation is the hard gate** (the enum is help, not the
guarantee).

## The endpoint (preview, no save — D-040)

`POST /api/sites/:siteId/pages/:pageId/ai-edit` (admin-gated, rate-limited):

- Body: `{ instruction: string, target_id?: string }`.
- Loads the page's current blocks, calls `proposeEdit`, returns
  `{ mode, message, proposed_blocks, diff }`. **It has no write path — SELECT
  only**, so a preview can never persist. A rejected proposal returns **422**.
- Rate limit: a dedicated `aiLimiter` (default **30/min**, separate from the save
  limiter — AI calls cost money). `max_tokens` capped at 4096.

**Apply** is a separate, explicit operator action that reuses the existing
`POST …/pages/:pageId` save endpoint with **`source:"ai"`** — so an AI edit gets
the same re-validation + `page_revisions` row (undo) as a manual save, tagged
`ai` in history. No new save path.

## The "Ask AI" panel

`src/admin/pages/EditorPage.tsx` (`AskAiPanel`): an "Ask AI" toggle in the editor
opens an instruction box → **Propose** (`ai-edit`) → renders the model `message`
+ `diff.summary` → **Apply** (save `proposed_blocks` with `source:"ai"`, then
`reload()` remounts the editor with the applied blocks) / **Reject** (discard).
The panel does **not** import Puck (D-017) — it produces `Block[]`; the editor
re-renders. Errors (including a 422 rejection, surfacing the server's detailed
message) show inline.

## Prompt caching + cost (P6-T6.7)

- The request sends `system` as a content-block array with
  `cache_control:{type:"ephemeral"}`. Tools render before system, so the single
  breakpoint caches **tools + system + catalog** — the stable prefix. The
  volatile current blocks + instruction live in `messages`, after the breakpoint.
- The system text is byte-stable (constant intro + the deterministic catalog),
  so it caches across requests (Sonnet's min cacheable prefix is 2048 tokens;
  system + catalog + tools exceeds it).
- **Cost (Sonnet 4.6, prefix cached):** ≈ $0.02–0.05 per edit (cache reads ~0.1×
  base input); a ~50-edit full site build ≈ $1–2.50. Bumping to Opus 4.7 roughly
  doubles that.

## Testing & visual QA

No browser/e2e on the operator's machine (no Chrome automation). Coverage:
typecheck + the AI service unit tests (Anthropic client + `fetch` **mocked** —
no network, no key, no spend), the endpoint integration tests (dry-run +
auth/validation/rate-limit, asserting the preview never persists), and the
"Ask AI" panel in jsdom with **Puck stubbed** (D-036). The unknown-type /
invalid-props guardrail is unit-tested. **Visual QA of the panel UX is
operator-run** at `studio.localhost:3000` once `ANTHROPIC_API_KEY` is set.
