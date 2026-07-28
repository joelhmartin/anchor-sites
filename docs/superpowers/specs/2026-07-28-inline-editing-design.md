# Inline Editing — Design Spec

**Date:** 2026-07-28
**Status:** Approved (operator, in-chat)
**Sub-project 2 of 3** in the "Lovable for websites" evolution. Builds on sub-project 1
(AI site agent, PR #6 — draft preview endpoint, conversation turn lock, revision
conventions). Branch: `feat/inline-editing`, stacked on `feat/ai-site-agent`.

## Purpose

A thin editing layer on the rendered page: click a headline and type, click an image and
swap it (or fix its alt text), fix a link — without round-tripping through Puck or asking
the AI. Puck and the agent remain the tools for structural work; this layer removes the
friction from trivial edits.

## Decisions locked during brainstorming

1. **Edit surface = the Studio draft-preview iframe**, gaining an edit mode. Tenant
   sites stay untouched static HTML; auth stays Studio's problem (already solved).
2. **Schema-derived editability.** Editable fields are derived from each block's Zod
   schema: top-level string props → text edit; props named `*asset_id` → image swap
   (+ alt); props classified as URLs → link popover, where "URL" means the Zod string
   carries a `.url()` check OR the prop name matches `/(^|_)(url|href|link)$/`. Arrays,
   slides, and `children` are OUT of v1.
3. **Debounced autosave.** Edits apply live; a 2s quiet period flushes one save + one
   revision (`source: 'inline'`) per burst. Subtle "Saved" indicator; rollback via the
   existing revisions panel.
4. **Pluggable image picker** with three source modules (Library / Upload / Stock) behind
   one `pick(): Promise<{ asset_id, alt? }>` interface — the explicit seam for a future
   AI-image-generation source (designed for, not built).
5. **Rich text = contenteditable + floating mini toolbar** (bold, italic, link, bulleted
   list), output sanitized to an allowlist client-side; server validation remains the
   trust boundary.

## Architecture

### One render path, always marked

- `@anchorcorps/components` (and the in-repo `rich-text` block) gain a small
  `<Editable field="...">` helper that wraps the element rendering each editable prop
  with a `data-field` attribute. Markers are emitted **always** (inert in normal
  renders) so edit mode can never drift from the real render. Components package bumps
  to 0.5.0 and republishes to Artifact Registry.
- `BlockRenderer` already emits `data-block-id` / `data-block-type` wrappers (Phase 5
  provision) — DOM→block mapping is free.
- A shared classifier derives `{ blockType → { field → 'text' | 'image' | 'url' } }`
  from the registry's Zod schemas (reusing the catalog's introspection approach). The
  overlay activates only elements whose `data-field` matches a classified prop.

### Edit-mode preview

- `GET /api/sites/:siteId/pages/:pageId/preview?edit=1` renders the same SSR page plus
  one `<script nonce="...">` tag loading a small **vanilla-JS overlay** (no React in the
  iframe). CSP for edit mode: `script-src 'nonce-<random>'`; the plain preview keeps
  `script-src 'none'`. The iframe keeps `sandbox="allow-scripts"` — postMessage works;
  the opaque origin still cannot reach Studio storage.
- The overlay: hover outlines on activatable elements; click → contenteditable (text) or
  a swap request (image) or a link popover (url); Escape/blur ends a field edit.

### The bridge (overlay ↔ Studio)

postMessage both ways, guarded by origin checks AND a per-session random token embedded
in the edit-mode page (echoed in every message).

- Overlay → Studio: `{ type: 'field-edit', blockId, field, kind, value }` (debounced),
  `{ type: 'image-pick-request', blockId, field }`, `{ type: 'edit-ready' }`.
- Studio → Overlay: `{ type: 'apply-image', blockId, field, src, alt }` (patch `<img>`
  without reload), `{ type: 'set-readonly', on, reason }`, `{ type: 'field-reject',
  blockId, field, value }` (revert on 422).

### Save engine (Studio-side)

- While edit mode is on, Studio holds the page's `Block[]`; incoming field edits patch
  `blocks[blockId].props[field]`. A 2s debounce flushes one POST to the existing
  page-save endpoint (full blocks, validated server-side, `source: 'inline'`).
- Failure: keep local edits, retry with backoff, error chip. 422: revert that field via
  `field-reject`, toast. Same invariant as everywhere: invalid blocks cannot persist.
- **Agent-conflict guard:** while the site's conversation status is `running` (PR #6
  turn lock), edit mode is read-only with a banner. Inline editing never blocks the
  agent (agent tools re-read blocks per call).

### Image flow

Click image → Studio-side popover (React): tabs Library / Upload / Stock, alt-text field
always visible. Library lists `media_assets`; Upload uses the signed-URL pipeline; Stock
reuses the server's Pixabay search + SSRF-guarded `ingestImageFromUrl` (new thin admin
endpoints wrapping what the agent tools already do). On pick: patch blocks, save, and
`apply-image` the new variant URL into the iframe (no reload).

### Rich text

contenteditable on the marked element; on selection, a floating toolbar: bold / italic /
link / bulleted list. Output sanitized client-side to `p b i strong em a ul ol li br`
(attribute allowlist: `a[href]` http/https only) before send.

## Error handling

- Bridge messages failing validation (unknown blockId/field, wrong token/origin) are
  dropped silently server-of-truth-side (Studio) and logged to console in dev.
- Preview iframe navigation/reload re-handshakes (`edit-ready` → Studio re-sends
  readonly state).
- Version skew (page saved elsewhere mid-session, e.g. Puck in another tab): v1 is
  last-write-wins, same as Puck today; revisions are the safety net.

## Testing

- Unit: schema classifier; overlay logic in jsdom (click→contenteditable, debounce →
  correct payloads, toolbar → sanitized HTML, token/origin guards); Studio save engine
  (fake timers: one save per burst; 422 revert path).
- Integration: `?edit=1` emits markers + nonce'd script + relaxed CSP; plain preview
  stays script-dead; saves produce `source:'inline'` revisions; image endpoints
  (library list / stock search / import) scoped + guarded.
- Components: `<Editable>` render tests (marker present, no behavior change).

## Out of scope (v1)

Arrays/slides/children editing; block add/remove/reorder (Puck/AI); editing published
pages directly (drafts only; publish stays manual); multi-user presence; AI image
generation (seam only); tenant-site edit overlay.

## Definition of done

1. In Studio, with the preview open in edit mode: click any headline/paragraph on a
   draft page, type, pause — one `inline` revision lands; the revisions panel can roll
   it back.
2. Click an image → picker (library/upload/stock) → swap + alt edit land as block-prop
   changes, iframe updates without reload.
3. Rich-text selection toolbar bolds/italicizes/links/bullets; output passes the
   sanitizer and server validation.
4. While the AI agent runs a turn on the site, edit mode is visibly read-only and
   recovers automatically.
5. Plain (non-edit) previews are byte-identical in behavior to today: no scripts run.
6. Full suite green; components package published at 0.5.0.
