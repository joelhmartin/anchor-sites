# Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click-to-edit text, image swapping (+ alt), and link fixes directly on the Studio draft-preview iframe, saving as debounced `inline` revisions (spec: `docs/superpowers/specs/2026-07-28-inline-editing-design.md`).

**Architecture:** The preview endpoint gains `?edit=1`, which renders the same SSR page with `data-block-id`/`data-field` markers, an inlined nonce'd vanilla-JS overlay, and a per-request bridge token. The overlay talks to Studio via postMessage; Studio owns the blocks copy, the debounced save engine, and the image-picker dialog. Components gain an `<Editable>` helper (always-marked, placeholder-aware in edit mode).

**Tech Stack:** TypeScript ESM (`.js` suffixes), esbuild (new direct dep — compiles the overlay to an inlinable IIFE at first request), React 18 (Studio only — the overlay is vanilla), Radix Dialog (picker), existing media/save/revision APIs, vitest + supertest + jsdom.

## Global Constraints

- Branch `feat/inline-editing` (stacked on `feat/ai-site-agent`). Baseline suite 986/986 must stay green.
- **Plain previews are byte-identical in behavior to today**: no `?edit=1` → CSP stays exactly `sandbox allow-scripts; default-src 'self' https: data:; style-src 'unsafe-inline' https: data:; img-src https: data:; script-src 'none'; frame-ancestors 'self'`, no scripts, no data-block wrappers (spec DoD #5).
- **The iframe keeps `sandbox="allow-scripts"`** (opaque origin). Consequences (verified): CSP `'self'` matches nothing inside it, so the overlay MUST be an inline `<script nonce="...">`; `postMessage` events from it arrive with `event.origin === "null"` — Studio validates messages by the per-request **bridge token**, not origin; the overlay validates inbound messages by the same token (its `event.origin` check uses the Studio origin, which IS real from the iframe's perspective via `event.origin` on messages posted from the parent — belt and suspenders: token required in every message both ways).
- Editability is schema-derived (classifier), DOM-anchored (`data-field`). v1 scope: TOP-LEVEL props only — text = `ZodString` that is NOT an enum and NOT url-classified; url = `.url()` check or name matching `/(^|_)(url|href|link)$/`; image = name matching `/asset_id$/`. Arrays/children/enums excluded.
- Saves: full-blocks POST to the existing save endpoint, `source: 'inline'`, one revision per 2s-quiet burst. Server validation is the trust boundary (invalid blocks cannot persist).
- Edit mode is read-only while the site's agent conversation status is `running` (or a drawer send is in flight).
- Components package: version 0.5.0 in BOTH `package.json` and the exported `VERSION` const (currently drifted 0.4.0 vs 0.3.0 — fix as part of Task 2).
- Error shapes / router / test conventions: identical to the AI-agent plan (factories, per-route `requireAdmin()`, in-repo `rateLimit`, `d`-gated node tests via `setupAgentDb()`, jsdom pragma tests, `TEST_DATABASE_URL=postgres://anchor:anchor@localhost:5434/anchor_test npx vitest run <file>`).
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
src/editor-overlay/main.ts (+ modules)            T5-T7 (vanilla overlay: bridge, text, toolbar, images)
src/server/preview-overlay.ts (+.test.ts)         T1  (esbuild compile-once + nonce helper)
packages/components/src/editable.tsx (+.test.tsx) T2  (<Editable> + EditModeContext, exported)
packages/components/src/blocks/*/component.tsx    T2  (markers on hero, cta, array-block headings, image)
src/blocks/rich-text/component.tsx                T2  (marker on the html field)
src/blocks/editable-fields.ts (+.test.ts)         T3  (schema classifier)
src/server/render-page.tsx                        T4  (Modify: editable opts → markers + inline script + boot data)
src/server/routes/admin-pages.ts                  T4  (Modify: ?edit=1 branch — nonce CSP, token, overlay)
src/server/routes/media.ts (+ tests)              T8  (Modify: stock-search + stock-import endpoints)
src/admin/lib/inline-editor.ts (+.test.ts)        T9  (bridge listener + patch + debounced save engine)
src/admin/components/ImagePickerDialog.tsx (+t)   T10 (source-module picker: Library/Upload/Stock)
src/admin/components/AgentChatDrawer.tsx          T11 (Modify: onStatusChange prop)
src/admin/pages/SiteDetailPage.tsx (+t)           T11 (Modify: edit toggle, wiring, readonly gating)
tests/integration/inline-editing.test.ts          T12 (end-to-end render+save gate)
docs/inline-editing.md                            T12
```

---

### Task 1: Overlay compile + nonce plumbing

**Files:**
- Modify: `package.json` (add `esbuild` as a direct dependency — the server compiles at runtime under tsx; pin `^0.25.0` or match the version already present transitively via tsx to avoid a second copy)
- Create: `src/server/preview-overlay.ts`
- Create: `src/editor-overlay/main.ts` (placeholder module for now — Task 5 fills it)
- Test: `src/server/preview-overlay.test.ts` (node, no DB)

**Interfaces (Produces):**
```ts
// src/server/preview-overlay.ts
export function getOverlayJs(): string;      // esbuild-bundled IIFE of src/editor-overlay/main.ts, compiled once and cached (module-level); throws with a clear message if compilation fails
export function __resetOverlayCacheForTests(): void;
export function makeNonce(): string;         // 16 random bytes, base64url (crypto.randomBytes)
```

- [ ] **Step 1: Write failing tests**

```ts
// src/server/preview-overlay.test.ts
import { describe, it, expect } from "vitest";
import { getOverlayJs, makeNonce, __resetOverlayCacheForTests } from "./preview-overlay.js";

describe("preview overlay compiler", () => {
  it("compiles the overlay entry to a self-contained IIFE containing the boot marker", () => {
    __resetOverlayCacheForTests();
    const js = getOverlayJs();
    expect(js).toContain("__AC_EDIT_OVERLAY__");   // marker constant in main.ts
    expect(js).not.toContain("import ");            // bundled, no bare imports
  });
  it("caches between calls", () => {
    __resetOverlayCacheForTests();
    expect(getOverlayJs()).toBe(getOverlayJs());    // same string identity
  });
  it("makeNonce returns distinct url-safe values", () => {
    const a = makeNonce(); const b = makeNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run src/server/preview-overlay.test.ts`)
- [ ] **Step 3: Implement**

```ts
// src/editor-overlay/main.ts (placeholder — Task 5 replaces the body, keeps the marker)
export const __AC_EDIT_OVERLAY__ = true;
// Boot happens in Task 5; keep a no-op so the bundle is valid.

// src/server/preview-overlay.ts
import { buildSync } from "esbuild";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(__dirname, "..", "editor-overlay", "main.ts");

let cached: string | null = null;

/**
 * Compile the vanilla-JS edit overlay to a single inlinable IIFE. esbuild is a
 * direct dependency (the runtime executes TS via tsx, so there is no build-time
 * artifact to read); compilation runs once per process and is ~10ms.
 * Inline-with-nonce is REQUIRED: the preview iframe is sandboxed (opaque
 * origin), where CSP 'self' matches nothing — an external script URL cannot work.
 */
export function getOverlayJs(): string {
  if (cached) return cached;
  const result = buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: true,
  });
  if (!result.outputFiles?.[0]) throw new Error("editor overlay compilation produced no output");
  cached = result.outputFiles[0].text;
  return cached;
}

export function __resetOverlayCacheForTests(): void { cached = null; }

export function makeNonce(): string {
  return randomBytes(16).toString("base64url");
}
```

- [ ] **Step 4: Run → pass**; `npm run typecheck`
- [ ] **Step 5: Commit** — `feat(inline): overlay compile-once plumbing + nonce helper`

---

### Task 2: `<Editable>` helper + markers in components

**Files:**
- Create: `packages/components/src/editable.tsx`
- Test: `packages/components/src/editable.test.tsx`
- Modify: `packages/components/src/index.ts` (export `Editable`, `EditModeContext`, `EditModeProvider`; bump `VERSION` to `"0.5.0"`), `packages/components/package.json` (version `0.5.0`; check `index.test.ts` for a VERSION assertion and update)
- Modify components: `hero/component.tsx` (eyebrow, title, subtitle, cta_label + cta_href), `cta/component.tsx` (heading, body, button_label + button_href), `faq-accordion/component.tsx` (heading only), `testimonial-carousel/component.tsx` (heading only), `logo-reel/component.tsx` (heading only), `image/component.tsx` (data-field on the `<picture>` + missing-asset sizing), `src/blocks/rich-text/component.tsx` (data-field on the inner div)
- Tests: extend each touched component's existing test file

**Interfaces (Produces):**
```tsx
// packages/components/src/editable.tsx
export const EditModeContext: React.Context<boolean>;               // default false
export function EditModeProvider(props: { children: React.ReactNode }): JSX.Element; // value=true
export function Editable(props: {
  field: string;
  as?: keyof JSX.IntrinsicElements;      // default "span"
  className?: string;
  value: string;                          // the prop value (may be "")
  placeholder?: string;                   // shown in edit mode when value is empty
  children?: React.ReactNode;             // custom rendering of value (defaults to {value})
}): JSX.Element | null;
```

**Behavior (exact):**
- Normal mode (`EditModeContext` false): if `value` is empty → render `null` (preserves today's conditional-render behavior EXACTLY); else render `<As data-field={field} className={...}>{children ?? value}</As>`.
- Edit mode: ALWAYS render the element; when `value` is empty, render `<As data-field={field} data-empty="true" className={...}>{placeholder ?? "Add " + field.replace(/_/g," ") + "…"}</As>`. This closes the verified conditional-render trap (empty fields are otherwise unclickable).
- Link fields (`cta_href` etc.) are NOT wrapped — the overlay finds them via the classifier + the `data-field` of their sibling label (v1 rule: a url prop is edited through a popover opened from its BLOCK's outline toolbar, not a DOM anchor — simpler and avoids nested-interactive markup). So components only wrap text props; the `image` block adds `data-field="asset_id"` directly on its `<picture>` (both the normal and missing branches — give the missing branch `style={{ minHeight: 80 }}` ONLY when `useContext(EditModeContext)` is true so it is clickable).
- `phone-number` is NOT wrapped in v1 (its `memo(() => true)` is irrelevant to SSR, but its props are semantically a pair — defer).

**Component edit pattern (hero shown; replicate the same mechanical transform per listed prop — conditional guards `{x && ...}` are REPLACED by the Editable, which owns the empty behavior):**

```tsx
// packages/components/src/blocks/hero/component.tsx — before:
//   {eyebrow && <p className="ac-hero__eyebrow ...">{eyebrow}</p>}
// after:
<Editable field="eyebrow" as="p" className="ac-hero__eyebrow uppercase tracking-wider text-sm opacity-80 mb-2" value={eyebrow} />
// title (unconditional today):
<Editable field="title" as="h1" className="ac-hero__title text-4xl md:text-5xl leading-tight mb-4" value={title} />
```
CTA buttons: wrap only the LABEL text inside the anchor: `<a href={cta_href}><Editable field="cta_label" value={cta_label} /></a>`, and keep the whole button conditional on `cta_label || editMode` (read `useContext(EditModeContext)`).

- [ ] **Step 1: Write failing tests** — `editable.test.tsx`: normal-mode empty → renders nothing; normal-mode value → element with `data-field`, no `data-empty`; edit-mode empty → placeholder + `data-empty`; edit-mode value → value. Per-component: render hero inside `EditModeProvider` with empty eyebrow → `[data-field="eyebrow"][data-empty]` present; render hero normally with empty eyebrow → absent (regression: identical to today).
- [ ] **Step 2: Run → fail** (`npm run test:components` or `npx vitest run packages/components`)
- [ ] **Step 3: Implement** helper + apply to all listed components + version bumps
- [ ] **Step 4: Run components suite + FULL suite** (renderer snapshots may exercise components) + `npm run build:components` + typecheck
- [ ] **Step 5: Commit** — `feat(inline): Editable marker helper + data-field markers (components 0.5.0)`

---

### Task 3: Schema classifier

**Files:**
- Create: `src/blocks/editable-fields.ts`
- Test: `src/blocks/editable-fields.test.ts` (node, no DB — registry only)

**Interfaces (Produces):**
```ts
export type FieldKind = "text" | "url" | "image";
export type EditableFieldMap = Record<string, Record<string, FieldKind>>; // blockType → field → kind
export function buildEditableFieldMap(): EditableFieldMap;  // walks listBlocks() like catalog.ts
```

**Classification rules (exact, applied to each block schema's TOP-LEVEL shape entries, unwrapping `.default()`/`.optional()` wrappers via `_def.innerType` like zod-fields does — read `src/editor/zod-fields.ts` for the established unwrap helper and reuse/extract it rather than reimplementing):**
1. Name matches `/asset_id$/` → `image`.
2. `ZodString` with a `url` check, OR name matches `/(^|_)(url|href|link)$/` → `url`.
3. Other bare `ZodString` (NOT `ZodEnum`, not inside arrays/objects) → `text`.
4. Everything else (enums, numbers, booleans, arrays, objects) → excluded.

- [ ] **Step 1: Write failing tests** — import `"./index.js"` side-effect; assert against the REAL registry: `hero` → `{eyebrow: "text", title: "text", subtitle: "text", cta_label: "text", cta_href: "url"}` and NOT `align`; `image` → `{asset_id: "image", alt: "text"}` and NOT `fit`/`aspect_ratio` (enums) — verify actual schema field lists first and adjust expectations to reality; `rich-text` → `{html: "text"}`; `faq-accordion` → `{heading: "text"}` only (items array excluded).
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~60 lines)
- [ ] **Step 4: Run → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): schema-derived editable-field classifier`

---

### Task 4: Edit-mode render + preview route branch

**Files:**
- Modify: `src/server/render-page.tsx` (opts gain `editable?: { overlayJs: string; nonce: string; bootData: object }`)
- Modify: `src/server/routes/admin-pages.ts` (preview handler `?edit=1` branch)
- Test: extend `tests/integration/ai-agent-routes.test.ts`'s preview tests OR create `tests/integration/inline-preview.test.ts` (preferred — new file, same per-router pattern)

**renderPage changes (exact):**
- When `opts.editable` is set: wrap the block tree in `<EditModeProvider>` (import from `@anchorcorps/components`), pass `editable` to `<BlockRenderer blocks={...} editable />` (existing prop — emits `data-block-id` wrappers), and append to `headExtra`:
```ts
const editHead = opts.editable
  ? `\n<script nonce="${opts.editable.nonce}">window.__AC_EDIT_BOOT__ = ${JSON.stringify(opts.editable.bootData).replace(/</g, "\\u003c")};\n${opts.editable.overlayJs}</script>`
  : "";
// headExtra: jsonLd ? `${seoMeta}\n  ${jsonLd}${editHead}` : `${seoMeta}${editHead}`
```
(The `\u003c` escape prevents `</script>` breakout from any string in bootData.)
- Also thread `extraCss` with the overlay's minimal CSS (outline styles) via the existing `shell()` `extraCss` hook when editable: `[data-field]{outline:1px dashed transparent} ...` — Task 5 defines the real CSS constant `OVERLAY_CSS` exported from `src/server/preview-overlay.ts`.

**Preview route `?edit=1` branch (exact, after the existing page/site load — plain path unchanged):**
```ts
const editMode = req.query.edit === "1";
let editable;
if (editMode) {
  const nonce = makeNonce();
  const bridgeToken = makeNonce();
  editable = {
    overlayJs: getOverlayJs(),
    nonce,
    bootData: {
      token: bridgeToken,
      siteId, pageId,
      fields: buildEditableFieldMap(),
      readonly: false,
    },
  };
  res.setHeader("Content-Security-Policy",
    "sandbox allow-scripts; default-src 'self' https: data:; " +
    "style-src 'unsafe-inline' https: data:; img-src https: data:; " +
    `script-src 'nonce-${nonce}'; frame-ancestors 'self'`);
} else {
  /* existing literal CSP header stays byte-identical */
}
```
The bridge token is ALSO returned to Studio: the edit-mode response sets header `X-Edit-Token: <bridgeToken>` — but the iframe consumer can't read headers; instead Studio GENERATES the token and passes it in: `?edit=1&bridge=<token>` (token minted by Studio via `crypto.randomUUID()`, echoed into bootData by the server after a `^[A-Za-z0-9_-]{8,64}$` validation). Use THIS design (Studio-minted) — it keeps the server stateless. Reject malformed tokens with 400.

- [ ] **Step 1: Write failing tests** (per-router app + seedSite/seedPage with a hero + rich-text):
  - `?edit=1&bridge=tok_abc123` → 200; body contains `data-block-id`, `data-field="title"`, `window.__AC_EDIT_BOOT__`, `"token":"tok_abc123"`, `__AC_EDIT_OVERLAY__`; CSP header contains `script-src 'nonce-` and NOT `'none'`.
  - Plain preview (no edit) → CSP contains `script-src 'none'`; body contains NO `data-block-id`, NO `__AC_EDIT_BOOT__` (byte-behavior regression guard).
  - `?edit=1` with a malformed bridge (`bridge=<script>`) → 400.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run new file + existing preview tests + typecheck**
- [ ] **Step 5: Commit** — `feat(inline): edit-mode preview render (markers, nonce CSP, boot data)`

---

### Task 5: Overlay core — activation, text editing, bridge

**Files:**
- Create: `src/editor-overlay/main.ts`, `src/editor-overlay/bridge.ts`, `src/editor-overlay/text-edit.ts`, `src/editor-overlay/dom.ts`
- Modify: `src/server/preview-overlay.ts` (export `OVERLAY_CSS` string)
- Test: `src/editor-overlay/overlay.test.ts` (jsdom pragma — imports the TS modules directly, no esbuild needed in tests)

**Bridge protocol (Produces — Studio Task 9 consumes verbatim):**
```ts
// overlay → Studio (all messages include token)
type OverlayMsg =
  | { ac: "edit"; token: string; type: "edit-ready" }
  | { ac: "edit"; token: string; type: "field-edit"; blockId: string; field: string; kind: "text"|"url"; value: string }
  | { ac: "edit"; token: string; type: "image-pick-request"; blockId: string; field: string }
  | { ac: "edit"; token: string; type: "link-edit-request"; blockId: string; field: string; value: string };
// Studio → overlay
type StudioMsg =
  | { ac: "edit"; token: string; type: "apply-image"; blockId: string; field: string; src: string; alt: string }
  | { ac: "edit"; token: string; type: "apply-field"; blockId: string; field: string; value: string }   // link popover result AND 422 reverts
  | { ac: "edit"; token: string; type: "set-readonly"; on: boolean; reason?: string };
```
- `bridge.ts`: `initBridge(token)` — `window.parent.postMessage(msg, "*")` (parent origin unknowable from opaque origin; token is the auth), inbound listener validates `e.data?.ac === "edit" && e.data.token === token` and dispatches.
- `dom.ts`: `findEditables(fields)` — for each `[data-block-id]` wrapper, query `[data-field]` children; keep those whose `(blockType, field)` maps to `text` in bootData.fields (blockType from `data-block-type`). `blockIdFor(el)`, kind lookup.
- `text-edit.ts`: click → `el.contentEditable = "true"`, focus, select-all if `data-empty` (and clear the placeholder text; restore placeholder if blurred empty). `input` events debounce 400ms (OVERLAY debounce; the 2s SAVE debounce is Studio's) → `field-edit` with `el.innerText` (plain-text fields — rich-text is Task 6). Blur/Escape → end editing, flush pending. `apply-field` inbound → set `innerText` (the 422 revert path). Hover outline via `OVERLAY_CSS` classes; readonly mode removes contentEditable and shows a banner div (fixed top, amber).
- `main.ts`: read `window.__AC_EDIT_BOOT__`, init bridge, activate editables, send `edit-ready`. Keep the `__AC_EDIT_OVERLAY__` marker export.

- [ ] **Step 1: Write failing jsdom tests** — build a DOM fixture (`document.body.innerHTML` with block wrapper + `data-field` elements), stub `window.parent.postMessage` with a spy, boot `main` init with a fields map: click → contenteditable true; typing + 400ms fake-timer advance → ONE `field-edit` with correct blockId/field/value/token; Escape → editing ends; `apply-field` message with the right token reverts text; wrong token ignored; `set-readonly` disables editing + shows banner; empty-placeholder field clears on focus and restores on empty blur.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~250 lines across the four files) + `OVERLAY_CSS` (hover outline `outline:1.5px dashed #6366f1`, active `solid`, banner styles) + wire `extraCss` in render-page (Task 4 left the hook).
- [ ] **Step 4: Run → pass**; typecheck; re-run Task 4's integration file (overlay marker still present in compiled bundle)
- [ ] **Step 5: Commit** — `feat(inline): overlay core — activation, contenteditable text edits, token bridge`

---

### Task 6: Rich-text mini toolbar + sanitizer

**Files:**
- Create: `src/editor-overlay/rich-text.ts`, `src/editor-overlay/sanitize.ts`
- Modify: `src/editor-overlay/main.ts` (rich-text fields route here: kind "text" AND blockType "rich-text" field "html")
- Test: `src/editor-overlay/rich-text.test.ts` (jsdom)

**Behavior (exact):**
- The rich-text `data-field="html"` element edits as contenteditable HTML (not innerText). On selection inside it, position a floating toolbar (absolute div, created once) with buttons B / I / Link / • List → `document.execCommand("bold"|"italic"|"insertUnorderedList")`; Link prompts via a minimal inline input row in the toolbar (not `window.prompt` — blocked in sandboxed iframes without allow-modals) writing `execCommand("createLink", false, url)` with an `https?://` guard.
- `sanitize.ts`: `sanitizeHtml(html: string): string` — DOMParser-based walk; allowlist tags `P,B,I,STRONG,EM,A,UL,OL,LI,BR,H2,H3` (keep h2/h3 — existing rich-text content uses them per the block's aiHints); `A` keeps only `href` with `^https?:`; all other attributes stripped; disallowed nodes unwrapped (children kept), `SCRIPT/STYLE/IFRAME` removed entirely.
- Debounced `field-edit` sends `sanitizeHtml(el.innerHTML)`.

- [ ] **Step 1: Write failing tests** — sanitizer table tests (`<script>` removed; `<a href="javascript:x">` href stripped; `<div>` unwrapped keeping text; allowed tags survive; `onclick` stripped); toolbar appears on selection within the rich-text field and bold produces `<b>`/`<strong>` in the sent payload (jsdom execCommand is stubbed — spy on it rather than asserting DOM mutation); link guard rejects `javascript:`.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~180 lines)
- [ ] **Step 4: Run → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): rich-text mini toolbar + allowlist sanitizer`

---

### Task 7: Overlay images + links

**Files:**
- Create: `src/editor-overlay/images.ts`, `src/editor-overlay/links.ts`
- Modify: `src/editor-overlay/main.ts`
- Test: `src/editor-overlay/images.test.ts` (jsdom)

**Behavior:**
- Image fields (`kind === "image"`, i.e. the `image` block's `<picture data-field="asset_id">`): hover shows a small "Swap image" chip (absolutely positioned over the element); click chip OR the picture → `image-pick-request`. Inbound `apply-image` → replace the `<picture>`'s children with a single `<img src={src} alt={alt} class="ac-image__img">` (variants regenerate on next real render; the preview just needs to show the new image immediately). The missing-asset branch (`.ac-image--missing`, min-height applied in edit mode by Task 2) gets the same chip.
- Url fields: each block wrapper with any `url`-classified field gets a link chip ("Edit link · cta_href") in its outline toolbar area; click → `link-edit-request` with the current value (read from bootData? — the overlay doesn't know prop values for unmarked fields; INCLUDE current url values in bootData: Task 4's bootData gains `urls: Record<blockId, Record<field, string>>` built server-side from `page.blocks` + the classifier — add it in this task, updating the Task 4 integration test). Studio opens its popover (Task 11), sends back `apply-field`; the overlay updates any matching `<a href>` inside that block wrapper (best-effort cosmetic; the save is what matters).

- [ ] **Step 1: Write failing tests** — image click emits `image-pick-request`; `apply-image` swaps picture content; link chip emits `link-edit-request` with the bootData value; `apply-field` for a url updates the anchor's href.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~150 lines) + bootData.urls (server + integration test update)
- [ ] **Step 4: Run → pass** (overlay suite + Task 4 integration file); typecheck
- [ ] **Step 5: Commit** — `feat(inline): overlay image swap affordance + link chips`

---

### Task 8: Stock search/import admin endpoints

**Files:**
- Modify: `src/server/routes/media.ts` (two new routes in the existing factory)
- Test: extend `tests/integration/media-upload-url.test.ts` pattern in a new `tests/integration/media-stock.test.ts`

**Routes (Produces — picker Task 10 consumes):**
- `POST /api/sites/:siteId/media/stock-search` (`admin`, existing upload limiter): body `{ query: z.string().min(2).max(100), per_page: z.number().int().min(1).max(20).optional() }` → `{ mode, hits: [{ id, tags, preview, download_url, width, height, credit }] }` (same mapping as the agent tool — call `searchPixabay(query, { perPage })` and map `previewURL→preview, largeImageURL→download_url, imageWidth→width, imageHeight→height, user→credit`).
- `POST /api/sites/:siteId/media/stock-import` (`admin`, limiter): body `{ url: z.string().url(), alt: z.string().min(3).max(500) }` → calls `ingestImageFromUrl(pool, { siteId, url, alt })` (full SSRF/size/timeout guards ride along) → `202 { asset_id }`. Errors from the guard → `400 { error: "invalid payload", details: [{ path: "url", message: <guard message> }] }`.
- Site must exist (404 pattern as elsewhere). Factory deps: allow `searchFn` + `ingestFn` injection for tests.

- [ ] **Step 1: Write failing tests** — stub-mode search returns 3 hits with `download_url`; import with injected `ingestFn` spy → 202 + `{asset_id}`; import guard rejection (inject real ingest, use `http://` url) → 400 with the guard message; cross-site 404.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~90 lines)
- [ ] **Step 4: Run → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): operator stock-search/import endpoints`

---

### Task 9: Studio bridge + save engine

**Files:**
- Create: `src/admin/lib/inline-editor.ts`
- Test: `src/admin/lib/inline-editor.test.ts` (jsdom pragma, fake timers)

**Interfaces (Produces — Task 11 consumes):**
```ts
export type InlineEditorEvents = {
  onImagePickRequest: (blockId: string, field: string) => void;
  onLinkEditRequest: (blockId: string, field: string, value: string) => void;
  onSaveStateChange: (s: "idle" | "dirty" | "saving" | "saved" | "error") => void;
};
export type InlineEditorHandle = {
  token: string;                                     // mint on create (crypto.randomUUID())
  attach(iframe: HTMLIFrameElement): void;           // starts listening; call after mount
  applyField(blockId: string, field: string, value: string): void;   // Studio-initiated (link popover / picker alt) — patches + posts apply-field to iframe
  applyImage(blockId: string, field: string, assetId: string, src: string, alt: string): void;
  setReadonly(on: boolean, reason?: string): void;
  flush(): Promise<void>;                            // force-save pending (used on edit-mode exit)
  destroy(): void;
};
export function createInlineEditor(opts: {
  siteId: string; pageId: string;
  events: InlineEditorEvents;
  fetchImpl?: typeof apiFetch;                       // injectable
  debounceMs?: number;                               // default 2000
}): InlineEditorHandle;
```

**Behavior (exact):**
- On `attach`: GET `/api/sites/:siteId/pages/:pageId` → hold `blocks` in memory. Listen for `message` events; accept only `e.data?.ac === "edit" && e.data.token === token && e.source === iframe.contentWindow`.
- `field-edit` → find block by id, set `props[field] = value` (rich-text html included), mark dirty, restart the 2s debounce. On flush: POST the save endpoint with `{ blocks, source: "inline" }`; single-flight (a save in progress queues at most one follow-up). Success → `saved`; failure → retry once after 1500ms then `error` state (edits stay in memory; next edit re-arms). 422 → revert: re-GET the page, diff the rejected field back, post `apply-field` with the server value, state `error`.
- `image-pick-request` / `link-edit-request` → forward to events (Studio UI opens dialog/popover).
- `applyImage`: sets both `props[field] = assetId` AND (image block) `props.alt = alt`, saves (immediate flush — image picks shouldn't wait 2s), posts `apply-image` to the iframe.
- Guard: while `setReadonly(true)` — incoming field-edits are DROPPED (belt; the overlay also disables) and the iframe is told `set-readonly`.

- [ ] **Step 1: Write failing tests** (fake timers + stubbed `apiFetch` + a fake iframe `{ contentWindow: { postMessage: vi.fn() } }`): three rapid field-edits → exactly ONE POST after 2000ms with all three patches and `source:"inline"`; save failure → one retry then error state; 422 → re-GET + apply-field revert posted; image apply → immediate save + apply-image posted; wrong-token message ignored; readonly drops edits.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~220 lines)
- [ ] **Step 4: Run → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): Studio bridge + debounced single-flight save engine`

---

### Task 10: Image picker dialog

**Files:**
- Create: `src/admin/components/ImagePickerDialog.tsx`, `src/admin/components/image-sources.ts`
- Test: `src/admin/components/ImagePickerDialog.test.tsx` (jsdom)

**Interfaces:**
```ts
// image-sources.ts — the AI-generation seam: a source is data + behavior, the dialog just renders the list
export type PickedImage = { asset_id: string; alt: string; src: string };  // src = best ready variant URL (largest jpg) or "" if variants pending
export type ImageSource = {
  id: "library" | "upload" | "stock";   // future: "generate"
  label: string;
  Component: React.ComponentType<{ siteId: string; alt: string; onPick: (p: PickedImage) => void; onError: (msg: string) => void }>;
};
export const imageSources: ImageSource[];
```
- `ImagePickerDialog` props: `{ siteId: string; open: boolean; initialAlt?: string; onClose: () => void; onPick: (p: PickedImage) => void }`. Radix `Dialog` (existing `src/admin/ui/dialog.tsx`), tab strip over `imageSources`, shared alt-text `Input` above the tabs (its value threads into `onPick`).
- **LibrarySource**: `useApi` GET `/api/sites/:siteId/media?limit=60`; grid of ready-variant thumbnails (reuse MediaTab's `pickThumb` logic — extract it to `src/admin/lib/media-utils.ts` and update MediaTab's import); click → `onPick` with largest jpg variant url.
- **UploadSource**: file input → the exact MediaTab 3-step flow (upload-url → PUT → complete), then poll `GET /media` every 1.5s up to 20s for `variants_status === "ready"`; ready → `onPick`; timeout → `onPick` with `src: ""` (Studio saves the asset_id anyway; preview shows on next reload) + info message.
- **StockSource**: query input → POST `stock-search`; grid of `preview` thumbs with credit; click → POST `stock-import { url: download_url, alt }` → same poll-for-ready as upload → `onPick`.

- [ ] **Step 1: Write failing tests** — mock `apiFetch`/`useApi`: library renders thumbs and pick returns asset+src+alt from the alt input; upload flow calls the 3 endpoints in order (spy) then picks after a mocked ready poll; stock search renders hits and import → poll → pick; alt input value flows into every source's pick.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** (~260 lines total)
- [ ] **Step 4: Run → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): pluggable image picker (library/upload/stock; AI-gen seam)`

---

### Task 11: Site-detail integration + agent guard

**Files:**
- Modify: `src/admin/components/AgentChatDrawer.tsx` (add prop `onStatusChange?: (status: "active"|"error"|"archived"|"running"|null, busy: boolean) => void` — call it wherever `conversation` or `sending`/`liveTurn` changes; `busy = sending || liveTurn !== null || status === "running"`)
- Modify: `src/admin/pages/SiteDetailPage.tsx` (DraftPreview gains edit mode)
- Create: `src/admin/components/LinkPopover.tsx` (tiny: Radix Dialog with one url Input + Save/Cancel, `https?://` validation)
- Tests: extend `SiteDetailPage.test.tsx`, `AgentChatDrawer.test.tsx`

**DraftPreview changes (exact):**
- Header row gains an "Edit" toggle button (`aria-pressed`). Edit ON: iframe src gains `&edit=1&bridge=${handle.token}`; the panel widens (`max-w-md` → `max-w-3xl`) and grows (`h-96` → `h-[70vh]`); a save-state chip renders next to the toggle ("Saved · just now" / "Saving…" / amber "Save failed — retrying"). Edit OFF (or unmount): `await handle.flush()`, destroy.
- Create the `InlineEditorHandle` when edit turns on (`createInlineEditor` + `attach(iframeRef.current)` on iframe load event); `onImagePickRequest` → open `ImagePickerDialog` (pick → `handle.applyImage`); `onLinkEditRequest` → open `LinkPopover` (save → `handle.applyField`).
- Agent guard: `AgentChatDrawer`'s `onStatusChange` lifts to `SiteDetailView` state; while `busy`, DraftPreview calls `handle.setReadonly(true, "The AI is working on this site…")` and shows the banner state on the toggle row; on un-busy → `setReadonly(false)`.
- The change-event iframe reload (`previewNonce` bump) is SUPPRESSED while edit mode is on and dirty (a reload would drop the contenteditable session) — queue the reload for edit-mode exit.

- [ ] **Step 1: Write failing tests** — drawer: `onStatusChange` fires with `busy:true` during a mocked send and on `status` sse event `running`; SiteDetailPage: Edit toggle adds `edit=1&bridge=` to iframe src and widens the panel; readonly banner appears while drawer reports busy; image-pick request path opens the dialog (mock `createInlineEditor` to capture events and invoke them).
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run jsdom suites → pass**; typecheck
- [ ] **Step 5: Commit** — `feat(inline): edit mode in site detail + agent-busy readonly guard`

---

### Task 12: End-to-end gate + docs

**Files:**
- Test: `tests/integration/inline-editing.test.ts`
- Create: `docs/inline-editing.md`
- Modify: `docs/ai-agent.md` (one line cross-linking the inline layer's `source:'inline'` revisions)

**The gate (per-router app, real DB, stub modes):**
1. Seed site + page (hero with empty `subtitle` + rich-text + image block with a seeded ready asset).
2. `GET preview?edit=1&bridge=tok` → assert markers (`data-field="title"`, `data-empty` on the empty subtitle), boot data (fields map includes `rich-text.html`, urls map includes hero `cta_href`), nonce CSP, overlay marker.
3. Simulate the save engine server-side contract: POST save with title patched + `source:"inline"` → 200; revisions list shows `source:"inline"` at top; restore the prior revision → title reverts (round-trip proof).
4. Stock endpoints: search (stub hits) + import with injected ingest spy.
5. Plain preview still `script-src 'none'`, no markers.

- [ ] **Step 1: Write the test** (gate, should pass against Tasks 1-11)
- [ ] **Step 2: Run FULL suite + typecheck** — green (baseline 986 + all new)
- [ ] **Step 3: Write `docs/inline-editing.md`** — architecture (marker/classifier/bridge/save), the bridge protocol table, editable-field rules incl. v1 exclusions (arrays, enums, phone-number), the sandbox/nonce security model, agent-busy guard, picker sources + the AI-gen seam, revision semantics (`source:'inline'`), operator notes (components 0.5.0 publish required before prod deploy: `npm run build:components` + AR publish per `packages/components/scripts/publish.sh`).
- [ ] **Step 4: Commit** — `test(inline): end-to-end edit-mode gate + docs`

---

## Self-Review Notes (performed at write time)

- **Spec coverage:** editable preview surface (T4/T5), schema-derived scope incl. exact url/enum rules (T3), debounced autosave + `inline` revisions + revert-on-422 (T9), pluggable picker with AI seam (T10), mini toolbar + sanitizer (T6), agent-busy readonly (T11), plain-preview byte-behavior guard (T4/T12), components 0.5.0 (T2), DoD items 1-6 mapped across T5/T7/T9 (1), T7/T10 (2), T6 (3), T11 (4), T4/T12 (5), T2/T12 (6).
- **Verified-fact alignment:** inline-nonce script (opaque-origin CSP), Studio-minted bridge token, `BlockRenderer editable` reuse, `headExtra`/`extraCss` shell hooks, conditional-render trap → placeholder behavior, enum exclusion, image-swap scope = image block only (arrays out), MediaTab 3-step upload + `pickThumb` extraction, no-Popover convention → Radix Dialog + hand-rolled overlay toolbar, esbuild-at-runtime (tsx has no build artifact), `savePayload.source` free-text ≤64.
- **Known drift risks (implementer must read-first, marked in-task):** exact hero/cta/image schema field lists (T3 expectations), `zod-fields` unwrap helper name (T3), `index.test.ts` VERSION assertion (T2), esbuild transitive version (T1), MediaTab thumb logic location (T10).
- **Type consistency:** `OverlayMsg`/`StudioMsg` shapes match between T5 (overlay) and T9 (Studio listener) and T7's additions; `PickedImage` flows T10 → T11 `applyImage(blockId, field, p.asset_id, p.src, p.alt)`; `InlineEditorHandle` names used in T11 match T9's exports; bootData fields (`token/siteId/pageId/fields/readonly/urls`) consistent T4/T5/T7.
