# Visual editor (Phase 5 — Puck)

The visual editor lets an operator open a page at `/sites/:slug/pages/:pageId`
in the Studio control hub and edit its blocks with drag-and-drop, side-panel
forms, undo/redo, and a responsive preview — then publish back through the
existing save + revision API. It is built on [Puck](https://puckeditor.com)
(`@measured/puck`, pinned `0.20.2`).

Decisions: **D-017** (Puck is the editor), **D-036** (version pin + `Block[]`↔`Data`
contract + jsdom test harness), **D-037** (Tiptap pin + custom-field registry).

## The boundary: `Block[]` is the source of truth; Puck is a view

`Block[]` (`{ id, type, props, children? }`, `pages.blocks` JSONB — D-001) stays
the canonical page shape. Puck's `Data` (`{ root, content, zones? }`) is only a
view that the editor converts to and from. The prod renderer never touches Puck.

- **One import boundary.** `src/editor/index.ts` is the *only* module that
  imports `@measured/puck`. Everything under `src/editor/` imports Puck symbols
  and types from this barrel; nothing outside `src/editor/` imports Puck. That
  keeps Puck swappable.
- **`src/editor/puck-adapter.ts`** — `toPuckData(blocks)` / `fromPuckData(data)`.
  - top-level blocks ↔ `data.content`;
  - `block.id` is stored inside `ComponentData.props.id` (Puck's `WithId`) and
    stripped back out (so a block's own `props` must not use a reserved `id`);
  - nested `block.children` ↔ Puck's flat `zones` map keyed `${id}:children`
    (recursive); `data.root` is always `{}`.
  - Purely structural — no registry lookup, so unknown block types round-trip
    unchanged. `fromPuckData(toPuckData(x))` deep-equals `x` is a tested invariant.

## Fields come from the Zod schema (never defined twice)

- **`src/editor/zod-fields.ts`** — `zodToPuckFields(schema)` derives Puck fields
  from a block's Zod schema (D-002): string→text, number(+min/max)→number,
  boolean→radio, enum→select, object→object, array-of-object→array; wrappers
  (`Default`/`Optional`/`Nullable`/`Effects`) unwrapped; anything else →
  `textarea` fallback. `zodSchemaDefaults(schema)` extracts `.default(...)`
  values for Puck `defaultProps`.
- **`src/editor/puck-config.ts`** — `buildPuckConfig({ siteId })` assembles
  `Config.components` from the shared block registry (`listBlocks()`): each type →
  `{ label, fields, defaultProps, render: <the same component the prod renderer
  uses> }`. Plugin-registered blocks (D-016) appear automatically.

### Custom fields (richer than the Zod type implies)

`src/editor/field-overrides.ts` — `applyFieldOverrides(type, fields, opts)`
replaces specific props (incl. nested array sub-fields) with custom fields:

- **Rich text** (`src/editor/custom-fields/tiptap-field.tsx`) — `rich-text.html`
  is edited with Tiptap (`@tiptap/*` `3.23.5`). Stores the **same HTML string**
  the renderer injects via `dangerouslySetInnerHTML` — no storage change.
- **Image picker** (`src/editor/custom-fields/image-field.tsx`) — `image.asset_id`
  and `hero-slider.slides[].image_asset_id` pick a `media_assets` id from the
  site library (`GET /api/sites/:siteId/media`), showing ready-variant thumbnails.
- **Color** — skipped: no block has a per-block color prop; color comes from
  site/page brand tokens (D-029). The registry is the ready home if one is added.

## The editor route

`src/admin/pages/EditorPage.tsx` (`/sites/:slug/pages/:pageId`):

1. Resolve slug→site via `GET /api/sites`; load the page via
   `GET /api/sites/:siteId/pages/:pageId` (returns blocks + seo + status).
2. `toPuckData(blocks)` → render `<Puck config data onChange onPublish>`.
3. **Publish** → `fromPuckData` → `POST /api/sites/:siteId/pages/:pageId`
   (blocks + seo, `source: "editor"`) → writes a `page_revisions` row.
4. **Revision history** panel — `GET …/revisions`; "Restore" →
   `POST …/revisions/:id/restore`, then re-fetches the page so Puck remounts
   with the restored blocks (cross-session; Puck handles in-session undo/redo).
5. **Publish/draft toggle** — saves an optional `status` via the same endpoint,
   preserving live edits by tracking Puck's `onChange` data.

## How AI editing (Phase 6) stays decoupled

Phase 6 mutates the canonical `Block[]` directly (schema-validated edits) and
saves through the **same** `POST …/pages/:pageId` endpoint — it does not go
through Puck. Because `Block[]` is the source of truth and the renderer +
revision API are Puck-agnostic, AI edits and visual edits converge on the same
storage with no coupling. The editor simply re-loads and `toPuckData`s whatever
`Block[]` is current.

## Testing & visual QA

UI cannot be browser-verified on the operator's machine (no Chrome automation).
Coverage is typecheck + jsdom `@testing-library` + adapter/field/config unit
tests + the editor-route data-flow test (Puck stubbed). The adapter round-trip,
field generation, config assembly, and load→publish→revision→status plumbing are
all unit-tested. **Visual QA is operator-run** at `studio.localhost:3000`: drag/
reorder, side-panel + custom fields, viewport switcher, and that the preview
renders blocks identically to the live tenant site (same components + brand-token
`:root` vars). See D-036 for the Puck-in-jsdom mock-vs-shim gotcha.
