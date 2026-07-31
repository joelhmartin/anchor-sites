# Inline editing (click-to-edit preview)

Lets an operator edit text, rich text, links, and images directly inside the
draft preview iframe on the Studio workspace (`src/admin/pages/WorkspacePage.tsx`,
via `src/admin/components/SitePreviewPanel.tsx`), instead of only through the
block JSON editor or the AI agent. Saves land as ordinary `page_revisions` rows
(`source: 'inline'`) through the same save/restore endpoints the AI agent and
manual editor already use — inline editing adds a UI surface, not a new data
model.

Spec: `docs/superpowers/specs/2026-07-28-inline-editing-design.md`. Plan:
`docs/superpowers/plans/2026-07-28-inline-editing.md` (Tasks 1–12). Gate:
`tests/integration/inline-editing.test.ts`.

## Architecture

Four layers, each independently testable:

1. **Markers** (`packages/components/src/editable.tsx`, `Editable`) — every
   editable text prop in a block component is wrapped in `<Editable
   field="...">`. Driven by `EditModeContext` (default `false`, so every
   existing consumer — prod SSR, the tenant renderer, existing tests — is
   unaffected unless `EditModeProvider` wraps the tree):
   - Normal mode: empty value → renders `null` (byte-identical to the
     pre-inline-editing conditional-render guards it replaced); non-empty →
     `<Tag data-field={field}>{value}</Tag>`.
   - Edit mode: **always** renders the element (so empty fields stay
     clickable — this closes the "conditional-render trap" where an empty
     field had no DOM node to click). Empty → placeholder text +
     `data-empty="true"`.
   - The `image` block's `<picture data-field="asset_id">` and rich-text's
     `<div data-field="html">` don't use `Editable` (they're not plain text)
     but carry the same `data-field` marker convention directly, unconditional
     on edit mode.
2. **Classifier** (`src/blocks/editable-fields.ts`) — walks the live block
   registry's Zod schemas and builds `EditableFieldMap` (`blockType -> field
   -> FieldKind`) once per preview request. See "Editable-field rules" below.
3. **Bridge** (`src/editor-overlay/`, compiled + `src/admin/lib/inline-editor.ts`)
   — a `postMessage` protocol between the sandboxed preview iframe (the
   overlay) and Studio (the admin SPA). See "Bridge protocol" below.
4. **Save engine** (`src/admin/lib/inline-editor.ts`, `createInlineEditor`) —
   debounced, single-flight autosave against the existing page-save endpoint,
   `source: "inline"`. See "Save + revision semantics" below.

### Render-time wiring

`GET /api/sites/:siteId/pages/:pageId/preview?edit=1&bridge=<token>`
(`src/server/routes/admin-pages.ts`) is the one route branch all four layers
meet at:

- `bridge` is Studio-minted (`crypto.randomUUID()`), passed as a query param
  because an `<iframe src>` can't carry a custom header. The server only
  shape-validates it (`/^[A-Za-z0-9_-]{8,64}$/`) and echoes it back — it never
  generates, stores, or otherwise trusts the token itself; it's purely a
  correlation id both sides already agree on out of band.
- `buildEditableFieldMap()` (classifier) and `buildUrlValues(page.blocks,
  fields)` (current values of every `url`-classified field, so the overlay's
  link chip has a starting value without inferring it from markup) build
  `bootData`.
- `getOverlayJs()` (`src/server/preview-overlay.ts`) esbuild-bundles
  `src/editor-overlay/main.ts` into a single IIFE, **at runtime** — the repo
  runs TypeScript directly via `tsx`, so there's no build-time artifact to
  serve; the bundle is compiled once per process and cached (~10ms cold).
- `renderPage()` wraps `BlockRenderer` in `EditModeProvider` only when
  `editable` is present, and inlines the bundle as a nonce-scoped
  `<script nonce="...">window.__AC_EDIT_BOOT__ = {...}; <overlay-iife></script>`
  in `<head>`.
- Without `?edit=1`, none of this runs — same markup, same `script-src
  'none'` CSP as before Task 4. `tests/integration/inline-editing.test.ts`
  and `inline-preview.test.ts` both assert this byte-behavior guard.

## Editable-field rules

`classifyField(name, schema)` in `src/blocks/editable-fields.ts` walks only
the **top-level** keys of a block's Zod object shape — nothing recurses into
arrays or nested objects:

| Rule | Kind |
|---|---|
| Name matches `/asset_id$/` | `"image"` |
| `ZodString` with a `.url()` check, OR name matches `/(^|_)(url\|href\|link)$/` | `"url"` |
| Any other bare `ZodString` | `"text"` |
| Everything else (enum, number, boolean, array, object, nested shape) | excluded |

### v1 exclusions (deliberate, not gaps)

- **Arrays** — nothing recurses into a `z.array(...)` field (e.g. a
  hero-slider's slides, an FAQ accordion's items). Editing collection items
  inline is a bigger UI problem (add/remove/reorder) than a v1 click-to-edit
  layer should take on.
- **Enums** — `align`, `fit`, `max_width`, etc. are structurally excluded (not
  a `ZodString`), since an enum needs a picker UI, not free-text/contenteditable.
- **`phone-number` block** — the whole block type is not wrapped in
  `Editable` at all in v1. Its props are semantically a pair (raw number +
  display format) rather than independent text fields, and its CTM
  call-tracking swap behavior (`memo(() => true)`, irrelevant to SSR but
  relevant to why it isn't treated as plain text) makes naive inline editing
  a correctness risk. Deferred, not classified.
- **URL fields are not DOM-editable** — a `url`-classified field (e.g.
  `cta_href`) gets **no** `data-field` marker of its own; it's edited through
  a link-chip popover on the block's outline (Studio-side `LinkPopover`),
  never as an inline anchor/contenteditable. This avoids nested-interactive
  markup (`<a>` inside a click target) and keeps URL validation in one place.

## Bridge protocol

Both the overlay (inside the sandboxed, opaque-origin iframe) and Studio (the
parent frame) use `postMessage(msg, "*")` — there's no shared origin to
target, since the iframe has `sandbox allow-scripts` with **no**
`allow-same-origin`. Every message carries `ac: "edit"` and the Studio-minted
`token`; either side silently drops anything that doesn't match both. The
shapes below are binding across `src/editor-overlay/bridge.ts` and
`src/admin/lib/inline-editor.ts` — they're declared twice (the overlay bundle
isn't importable from admin code) and must be kept field-for-field identical.

**Overlay → Studio** (`OverlayMsg`):

| `type` | Fields | Sent when |
|---|---|---|
| `edit-ready` | — | Overlay finished booting (end of `boot()`) |
| `field-edit` | `blockId, field, kind: "text"\|"url", value` | Debounced text/rich-text edit (rich-text sends sanitized HTML) |
| `image-pick-request` | `blockId, field` | Operator clicks an image field or its "Swap image" chip |
| `link-edit-request` | `blockId, field, value` | Operator clicks a url field's link chip (`value` = current href, from bootData) |

**Studio → Overlay** (`StudioMsg`):

| `type` | Fields | Sent when |
|---|---|---|
| `apply-field` | `blockId, field, value` | Studio wrote a value back (link popover save, or a 400 revert) — overlay updates its DOM to match |
| `apply-image` | `blockId, field, src, alt` | Picker dialog resolved an asset — overlay swaps the `<picture>`'s children for a plain `<img>` |
| `set-readonly` | `on, reason?` | Agent-busy guard or an explicit Studio readonly flip |

## Save + revision semantics

`createInlineEditor()` (`src/admin/lib/inline-editor.ts`) holds an in-memory
copy of `page.blocks` (hydrated on `attach()` via `GET
/api/sites/:siteId/pages/:pageId`), patches it on every `field-edit`/
`applyField`/`applyImage`, and debounces a save:

- **Debounce + single-flight**: a `field-edit` restarts a 2s timer
  (`debounceMs`, injectable). If a save is already in flight when the timer
  fires, the next cycle is queued (`queuedFollowUp`) rather than firing a
  second concurrent POST — at most one save runs at a time, and at most one
  more is pending behind it.
- **The POST is the same endpoint everything else uses**: `POST
  /api/sites/:siteId/pages/:pageId` with `{ blocks, source: "inline" }`. The
  server treats an inline save exactly like a manual or AI save — it can't
  tell the difference except by the `source` string it stores on the new
  `page_revisions` row. `revisions` and `.../restore` (also pre-existing) are
  what the round-trip in the Task 12 gate exercises.
- **`applyImage` bypasses the debounce** — an image pick flushes immediately
  (no reason to wait 2s once the operator has already committed to a choice
  in a dialog).
- **Reject handling — the real contract is 400, not 422.** The server's save
  route (`admin-pages.ts`) rejects invalid block content with `400 {
  error: "block validation failed", failures }`; a bare `400` with any other
  shape is treated as a client-side bug, not a content rejection, and does
  **not** trigger a revert. `isBlockValidationReject()` checks for that exact
  shape (`error === "block validation failed"` or an array `failures`) OR a
  `422` — kept as a belt in case the contract changes, but 400+failures is
  what actually ships today. On a genuine reject, the engine re-`GET`s the
  page, diffs the rejected fields back to their last-known-good server value,
  and posts `apply-field` to visually revert the iframe — the operator sees
  their edit bounce back rather than silently vanishing.
- **Terminal (non-reject) failures don't lose data.** A network error retries
  once after 1500ms; if that also fails (and isn't itself a validation
  reject), the dirty fields are put back into the pending set rather than
  dropped, so the next edit — or `flush()` on edit-mode exit — resends them.
  Save state exposed to the UI: `idle | dirty | saving | saved | error`.
- **`flush()`** forces a save of anything pending; `SitePreviewPanel` calls it
  when edit mode turns off or the panel unmounts, so a debounce window can't
  eat an edit made right before closing.

## Sandbox / nonce security model

Defense in depth, two independent layers — **neither alone is sufficient**:

1. **Iframe sandboxing**: the preview `<iframe>` uses `sandbox allow-scripts`
   with no `allow-same-origin`, forcing the document onto an opaque origin.
   Nothing inside it can read/write the parent's DOM, cookies, or storage,
   and nothing outside can address it by origin — which is exactly why the
   bridge protocol above has to authenticate every message by a shared
   `token` instead of an origin check.
2. **Response CSP** (`admin-pages.ts`, set per-response, replacing the app's
   global helmet policy for this one route): plain preview stays
   `script-src 'none'`, unchanged from before inline editing existed. Edit
   mode swaps that for `script-src 'nonce-<random>'` scoped to the one inline
   `<script>` carrying `bootData` + the overlay IIFE — no other script can
   execute in that document even if something got injected into rendered
   block HTML. `style-src`/`img-src` stay `'unsafe-inline' https: data:` (the
   renderer inlines block CSS at module load; there's no separate
   stylesheet to allow instead) and `frame-ancestors 'self'`.

**The client-side allowlist sanitizer is the PRIMARY defense for rich-text,
not a belt-and-suspenders layer.** `src/editor-overlay/sanitize.ts`
(`sanitizeHtml`) runs in the sandboxed iframe on every outbound rich-text
`field-edit`, allowlisting `P,B,I,STRONG,EM,A,UL,OL,LI,BR,H2,H3`, stripping
all attributes except `A`'s `href` (only if `^https?:`), and removing
`SCRIPT/STYLE/IFRAME` entirely. **There is no server-side HTML sanitizer in
this codebase** — the rich-text block's Zod schema
(`src/blocks/rich-text/schema.ts`) only checks that `html` is a string, full
stop. If the client sanitizer has a bug or is bypassed (e.g. a direct API
call that skips the overlay), unsanitized HTML reaches the wire and gets
rendered `dangerouslySetInnerHTML` on every future page load. Treat changes
to the allowlist/removal rules as security-sensitive; a server-side pass is
future work, not yet built.

## Agent-busy guard

The AI site agent (`docs/ai-agent.md`) and inline editing can both write to
the same draft page's `blocks`, so they're mutually exclusive by UI, not by a
server-side lock: `useAgentConversation`'s `onStatusChange(status, busy)`
(`src/admin/components/agent-chat/useAgentConversation.ts`) lifts up to
`WorkspacePage`, which passes the resulting `agentBusy` flag down to
`SitePreviewPanel` — which, while `busy`, calls
`handle.setReadonly(true, "The AI is working on this site…")` on the inline
editor handle. That posts `set-readonly` to the overlay (disables the
`contenteditable`/pointer affordances and shows an amber banner in the
preview) and, belt-and-suspenders, the Studio-side engine also **drops**
any inbound `field-edit` while `readonly` is true rather than trusting the
overlay alone to have disabled itself. When the agent goes idle,
`setReadonly(false)` re-enables editing.

## Picker sources + the AI-gen seam

`ImagePickerDialog` (`src/admin/components/ImagePickerDialog.tsx`) renders a
tab strip over `imageSources` (`src/admin/components/image-sources.tsx`):

| Source | Behavior |
|---|---|
| `library` | `GET /api/sites/:siteId/media?limit=60`, grid of ready-variant thumbnails, pick → largest jpg variant URL |
| `upload` | The existing MediaTab 3-step flow (upload-url → PUT → complete), then polls `GET /media` (1.5s / 20s) for `variants_status: "ready"` |
| `stock` | `POST .../media/stock-search` (Pixabay, stub mode without an API key), pick a hit → `POST .../media/stock-import` → same ready-poll as upload |

Each source is `{ id, label, Component }` with a uniform
`{ siteId, alt, onPick, onError }` props contract — the dialog only ever
renders the active one. **This is the AI-generation seam**: a future
`"generate"` source is one more entry in `imageSources` with the same
contract; nothing in `ImagePickerDialog` itself needs to change.

### Stock endpoints (operator-facing, Task 8)

- `POST /api/sites/:siteId/media/stock-search` — `{ query, per_page? }` →
  `{ mode: "stub"|"api", hits: [{ id, tags, preview, download_url, width,
  height, credit }] }`. Stub mode (no `PIXABAY_API_KEY`) returns 3
  deterministic hits — no network call.
- `POST /api/sites/:siteId/media/stock-import` — `{ url, alt }` → `202 {
  asset_id }`, running the same `ingestImageFromUrl` SSRF/size/timeout guards
  as every other image ingest path (e.g. non-`https` urls 400 before any
  network call).

## Revision semantics (`source: 'inline'`)

Every inline save writes an ordinary `page_revisions` row with `source:
"inline"` — same table, same shape, same `revisions`/`.../restore` endpoints
the AI agent (`source: "ai"`) and manual editor already use. There is no
inline-specific revision type or table: an operator reviewing history sees
`inline`, `ai`, `manual`, and `restore:<id>` sources interleaved in one
reverse-chronological list, and restoring any of them works identically
regardless of which layer produced it. See `docs/ai-agent.md`'s revision
section for the AI-agent side of the same mechanism.

## Operator notes

- **`@anchorcorps/components` must be at `0.6.0` (or later) before deploying
  this feature to production.** Task 2 added `Editable`/`EditModeContext`/
  `EditModeProvider` and bumped the package to `0.5.0` (subsequent work has
  since bumped it further, to `0.6.0` as of this SDD round — check
  `packages/components/package.json` for the current version rather than
  trusting this number to stay current) — the renderer's
  `EditModeProvider` import (`src/server/render-page.tsx`) resolves against
  whatever version is published to Artifact Registry, not what's checked out
  locally. Before a prod deploy that includes this feature:
  1. `npm run build:components` (builds `packages/components/dist`).
  2. `packages/components/scripts/publish.sh` (or `--dry-run` to validate
     first) — publishes to the `npm-anchorcorps` AR repo per
     `docs/components-publish.md`.
  3. Confirm the renderer's deploy resolves the new version (`npm view
     @anchorcorps/components version` against the AR registry, or check the
     lockfile after `npm install`).
  Skipping this means the renderer keeps serving whatever `@anchorcorps/
  components` version was last published — edit mode's markers/empty-state
  handling silently won't exist in prod even though the server-side routes
  (preview branch, save, stock endpoints) are live.
