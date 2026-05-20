# Phase 5 — Visual editor on Puck

> **Goal:** Replace the Phase-4 `EditorPlaceholder` at `/sites/:slug/pages/:pageId`
> with a real drag-and-drop page editor built on **Puck** (D-017). An operator
> opens a page, edits its blocks visually (drag, reorder, side-panel forms,
> undo/redo, viewport preview), and publishes — saving back through the existing
> `pages.blocks` JSONB + revision API. Our `Block[]` shape stays the source of
> truth; Puck is only a *view* of it and lives entirely behind `src/editor/`.

> **This file is pre-drafted (2026-05-20) so the routine can start without an
> expansion/confirmation round-trip.** Operator: review/adjust before approving;
> the task list is a proposal grounded in D-017, not a contract. Reorder or split
> tasks freely. Each checkbox is its own commit (per the per-subitem cadence).

## Anchors that govern this phase

- **D-001** — `Block[]` (`{ id, type, props, children }`) in `pages.blocks` JSONB is the canonical shape. Puck's `{ content, root, zones }` is a view, never the source of truth.
- **D-002 / Zod-first** — every block's Zod schema generates the editor fields. We do NOT define fields twice.
- **D-017** — Puck is the editor. Block schemas, the registry (`src/blocks/registry.ts`), block components, and the prod renderer are unchanged — Puck *calls* our components and *emits* JSON we round-trip through `Block[]`. Nothing outside `src/editor/` imports Puck.
- **D-018** — block components come from `@anchorcorps/components` (the `ac-` prefixed public blocks) + the inline `rich-text` block. The editor renders the *same* components the prod renderer uses — no editor-only forks.
- **Existing API (Phase 4)** — save is `POST /api/sites/:siteId/pages/:pageId` (writes blocks+seo + a `page_revisions` row); revisions list `GET …/revisions`; restore `POST …/revisions/:revisionId/restore`. The editor builds on these; add a page-blocks GET only if one doesn't already exist.
- **Hard constraints** — UI can't be browser-verified on the operator's machine (no Chrome automation); verify with typecheck + jsdom @testing-library + adapter round-trip unit tests, and flag that visual QA needs the operator at `studio.localhost:3000`. Every push to `main` now auto-deploys prod (CI live, D-035) — keep `main` green; never push red tests. No `<form>` inside block/editor *previews* (admin chrome forms are fine, per the Phase 4 precedent).

## Decisions to record during execution

- **D-0xx — Puck version pin + data-shape conversion contract.** Pin a specific `@measured/puck` version; freeze the `toPuckData`/`fromPuckData` mapping (esp. how `children`/zones and block `id`s round-trip). Record once 5.1–5.2 land.
- Append any field-DSL gaps (Zod shapes Puck can't model) as they surface, with the custom-field workaround chosen.

## Tasks

### Foundation

- [x] **5.1 — Add & pin Puck; `src/editor/` scaffolding**
  - Add `@measured/puck` (pin the current stable version; record it). Ensure the admin Vite build + Tailwind content glob cover `src/editor/**`. Create `src/editor/` with a barrel. No editor route wired yet.
  - **Tests:** an import/smoke test that Puck loads in jsdom; build/typecheck clean.

- [x] **5.2 — `puck-adapter.ts`: `Block[]` ↔ Puck `Data` (lossless)**
  - `toPuckData(blocks: Block[]): Data` and `fromPuckData(data: Data): Block[]` in `src/editor/puck-adapter.ts`. Preserve block `id`, `type`, `props`, and nested `children`. Round-trip is a **tested invariant** (`fromPuckData(toPuckData(x))` deep-equals `x`).
  - **Tests:** round-trip for flat blocks, nested children, empty page; unknown-type passthrough behavior decided + tested.

- [x] **5.3 — `zodToPuckFields(schema)`**
  - Generate Puck field config from a block's Zod schema: string→text, number→number, boolean→radio/switch, enum→select, nested object→object fields, array→array fields, with labels/defaults. Document which Zod constructs are supported; unsupported ones fall back to a JSON/textarea field (and are candidates for custom fields in 5.6–5.8).
  - **Tests:** field generation per Zod type; unsupported-type fallback.

- [x] **5.4 — Assemble Puck `Config` from the block registry**
  - Build `Config.components` from `listBlocks()`: each registered type → `{ fields: zodToPuckFields(schema), render: component, defaultProps }`. Covers the inline `rich-text` block + the `@anchorcorps/components` blocks (hero, hero-slider, cta, testimonial-carousel, logo-reel, faq-accordion, image). Plugin-registered blocks (D-016) ride the same registry, so they appear automatically.
  - **Tests:** config includes every registered block; a block's fields match its schema; render maps to the shared component.

### Editor route

- [ ] **5.5 — Editor route replaces `EditorPlaceholder`**
  - At `/sites/:slug/pages/:pageId`: resolve slug→site (the Phase-4 client-side pattern), load the page's current blocks, `toPuckData`, render `<Puck config … data … onPublish>`. On publish: `fromPuckData` → `POST /api/sites/:siteId/pages/:pageId` (blocks + seo) → toast + revision written. Loading/error/dirty-state handling; a "Back to site" breadcrumb + "View live" link.
  - **Tests:** loads + renders Puck with converted data (jsdom); publish calls the save endpoint with the `fromPuckData` payload; save error surfaced.

### Custom fields

- [ ] **5.6 — Tiptap as a Puck custom field (rich text)**
  - Wrap Tiptap as a Puck custom field so the `rich-text` block edits inline-ish in the side panel (D-017). Reuse the existing `src/blocks/rich-text` rendering contract; store the same serialized shape the renderer expects.
  - **Tests:** field renders; edits flow into the block props; serialized output matches the renderer's expected shape.

- [ ] **5.7 — Image-picker custom field (media library)**
  - A Puck custom field that opens the Phase-3/4 media library (`GET …/media`) to pick an `image_asset_id` (used by hero-slider + the Image block). Shows ready-variant thumbnails; supports the upload flow or links to the Media tab.
  - **Tests:** field lists media; selecting sets the asset id on the block props.

- [ ] **5.8 — Color / brand-token custom field (if needed)**
  - For any block color props, a color field (reuse the Phase-4 `<input type=color>` + preview pattern from `BrandTokenFields`). Only build if a block actually needs per-block color props beyond site/page brand tokens; otherwise skip + note why.
  - **Tests:** field sets a valid color value on props.

### Revisions & polish

- [ ] **5.9 — Revisions panel in the editor**
  - List revisions (`GET …/revisions`) with timestamps/source; "Restore" (`POST …/revisions/:id/restore`) reloads Puck with the restored data. Puck supplies in-session undo/redo natively; this is cross-session history.
  - **Tests:** revisions render; restore reloads converted data.

- [ ] **5.10 — Publish/draft status + viewport preview**
  - Surface page `status` (draft/published) with a publish toggle (reuses the save endpoint's status handling). Puck's native viewport switcher for responsive preview. Confirm the preview renders blocks identically to prod (same components, brand-token `:root` vars applied in the preview frame).
  - **Tests:** status toggle persists; preview renders the shared components.

### Wrap

- [ ] **5.11 — Phase 5 docs + plan tick**
  - `docs/visual-editor.md`: the `Block[]`↔Puck boundary, `zodToPuckFields` coverage + custom fields, the editor route, how AI editing (Phase 6) stays decoupled. Record the Puck-version/contract decision in `DECISIONS.md`. Tick the `PLAN.md` Phase 5 row. Append `.routine/baseline-tests.log`.

## Demo milestones (chat-only)

- Puck loads in the editor route against a real page's blocks (after 5.5)
- Rich-text editing works inline (after 5.6)
- Image picker pulls from the media library (after 5.7)
- A full page edited + published round-trips through `Block[]` and renders on the live tenant site (after 5.10)
- Phase 5 complete (after 5.11)

## Definition of done

- `/sites/:slug/pages/:pageId` is a working Puck editor (drag/reorder/side-panel/undo-redo/viewport) — not a placeholder.
- Edits publish via the existing save+revision API; `Block[]` remains the stored source of truth; the prod renderer is unchanged and renders the saved page identically.
- `toPuckData`/`fromPuckData` lossless round-trip is a tested invariant; `zodToPuckFields` covers the live block schemas (custom fields for rich text + image).
- Nothing outside `src/editor/` imports Puck.
- Full test suite green; new tests for the adapter, field generation, config assembly, and the editor route. (Visual QA is operator-run — flagged, not claimed.)
- `PLAN.md` Phase 5 row ticked. Phase 6 not started — wait for `.routine/NEXT-PHASE-APPROVED`.

## Completion log

<!-- Routine appends entries below this line, newest first -->

### 2026-05-20 17:47 UTC — Task 5.4 (Assemble Puck `Config` from the block registry)
**Commit:** (this commit)
**Done:** `src/editor/puck-config.ts` — `buildPuckConfig(): Config` maps every `listBlocks()` entry → `{ label, fields: zodToPuckFields(schema), defaultProps: zodSchemaDefaults(schema), render: entry.component }`. Side-effect imports `../blocks/index.js` so the editor uses the SAME registry/components as the prod renderer (D-018). Plugin blocks (D-016) appear automatically. Added `zodSchemaDefaults` to `zod-fields.ts` (the deferred 5.3 defaults extraction). Exported `richTextBlock` from `src/blocks/rich-text/index.ts` (additive — self-registration unchanged) so tests re-register it without duplicating metadata.
**Tests added:** 5 (`src/editor/__tests__/puck-config.test.ts`): every registered block present; rich-text + all 7 package blocks covered; fields/defaultProps/label/render derive from each entry; defaultProps parse against their own schema; plugin-registered block picked up automatically. Order-robust via beforeEach reset+re-register from blockManifest + richTextBlock. Suite 314→319, cold-cache full run + typecheck green.
**Next:** 5.5 — editor route replaces `EditorPlaceholder` (needs jsdom @testing-library; first browser-ish surface — visual QA stays operator-run).
**Notes:** Categories (block-picker grouping from `entry.category`) intentionally deferred — not required for a working Config. Render is mapped by identity (no editor fork); full preview parity (MediaContext + brand-token `:root`) is 5.10.

### 2026-05-20 17:39 UTC — Task 5.3 (`zodToPuckFields(schema)`)
**Commit:** 79ac610
**Done:** `src/editor/zod-fields.ts` — `zodToPuckFields(schema): Fields` + `humanizeLabel`. string→text, number(+min/max)→number, boolean→radio(Yes/No), enum/nativeEnum→select, object→object(recursive), array-of-object→array(recursive); Default/Optional/Nullable/Effects unwrapped; everything else→textarea fallback. Structural `_def` introspection → no zod/Puck runtime import (runs in node). Documented coverage + fallback in D-036.
**Tests added:** 8 (`src/editor/__tests__/zod-fields.test.ts`): primitives, enum, nested object, array-of-object, wrapper-unwrapping, unsupported→textarea fallback (array-of-primitive/union/record), non-object top-level→{}, humanizeLabel cases. Suite 306→314, cold-cache full run + typecheck green.
**Next:** 5.4 — assemble Puck `Config` from the block registry.
**Notes:** Field VALUES/defaults (defaultProps) deferred to 5.4. Real registered-schema coverage is asserted in 5.4 ("a block's fields match its schema"). Textarea fallback is a placeholder; rich-text/image/color get custom fields in 5.6–5.8.

### 2026-05-20 17:34 UTC — Task 5.2 (`puck-adapter.ts` — `Block[]` ↔ Puck `Data`, lossless)
**Commit:** 43d0e87
**Done:** `src/editor/puck-adapter.ts` with `toPuckData`/`fromPuckData`. Block `id`→`props.id`; `props` spread; nested `children`→flat `zones` map keyed `${id}:children` (recursive); `root` always `{}`. Purely structural (no registry) → unknown types pass through. Imports Puck **types only** ⇒ no runtime Puck load, runs in plain node. Froze the conversion contract in D-036.
**Tests added:** 7 (`src/editor/__tests__/puck-adapter.test.ts`): empty page, flat blocks (assorted prop types), deep nesting, empty-vs-absent `children` distinction, unknown-type passthrough, id↔props.id + zones structure, id-strip on return. Round-trip is `toStrictEqual`. Suite 299→306, cold-cache full run + typecheck green.
**Next:** 5.3 — `zodToPuckFields(schema)`.
**Notes:** Only Block→Data→Block is lossless (Data→Block→Data isn't — `root` is dropped). `block.props` must not use a reserved `id` key. Editor-side rendering of nested zones (DropZone/slots) deferred to 5.4/5.5; current blocks are all leaf blocks.

### 2026-05-20 17:30 UTC — Task 5.1 (Add & pin Puck; `src/editor/` scaffolding)
**Commit:** 90d798d
**Done:** Pinned `@measured/puck` exactly `0.20.2` (`--save-exact`); created `src/editor/index.ts` — the sole Puck import boundary (D-017) re-exporting `Puck` + the `Config`/`Data`/`ComponentConfig`/`ComponentData`/`Field`/`Fields`/`Metadata` types + a `PUCK_VERSION` constant. No editor route wired yet. Recorded D-036 (pin + boundary + contract placeholder).
**Tests added:** 2 (`src/editor/__tests__/editor-smoke.test.tsx`): "loads Puck in jsdom and re-exports the editor component", "pins a Puck version that matches the installed package (no drift)". Suite 297→299, all green (cold-cache full run; `npm run build` + `npm run typecheck` clean).
**Next:** 5.2 — `puck-adapter.ts` `Block[]`↔Puck `Data` lossless round-trip.
**Notes:** Build wiring needed no changes — Tailwind glob (`./src/**`) + tsconfig `include` already cover `src/editor/**`, Vite bundles on import, Puck CSS deferred to the 5.5 route. jsdom gap: `@dnd-kit` references `ResizeObserver` at module load; added `src/editor/__tests__/puck-jsdom.ts` shim, imported before the Puck barrel in editor jsdom tests (extend for `<Puck>` render in 5.5). Pre-flight also surfaced a pre-existing order-flaky test (STATE `FLAKE-RESOLVESITE`) — non-blocking, CI-safe; documented, not fixed.
