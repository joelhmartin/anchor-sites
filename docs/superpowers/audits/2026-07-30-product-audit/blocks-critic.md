# Completeness Critic — Block Components Package + Seam Sweep

Slice: `packages/components` (Block-JSON registry) + every unit-class no prior slice owned.
Method: full source read of all 16 block types + every support module; consumers traced end-to-end
(registry → validate → render → hydrate → inline-edit → AI catalog → templates); two claims verified
empirically (SSR render of built package; live unauthenticated probes). Prior-slice reports skimmed
census-level to avoid double-reporting.

## Brief-premise corrections (verified, per operator's verify-don't-ask rule)

1. **`rich-text` is NOT in `packages/components`.** It is the one renderer-local block
   (`src/blocks/rich-text/{schema,component,index}.tsx` + own CSS), registered by side-effect import in
   `src/blocks/index.ts:24`. The "registry" is therefore split across two codebases: 15 package blocks
   (`packages/components/src/blocks/manifest.ts:69-100`) + 1 renderer block. Census covers all 16.
2. The KNOWN hydration gap (collectAssetIds missing `nav-bar.logo_asset_id` + `split-hero.image_asset_id`,
   `src/server/render-hydration.ts:21-31`) is exactly as briefed and is already **D901**
   (renderer-tenant.md). Not re-reported; the *other* members of that defect family are D1203 and D1214.
3. `buildPuckConfig` — referenced in both registries' type docs (`src/blocks/types.ts:40`,
   `packages/components/src/blocks/manifest.ts:30`) — **does not exist anywhere in the repo** (Puck removed
   Task B5). Everything documented as "buildPuckConfig will inject…" is dead promise → D1201.

## PART 1 — Census (M = 40 units)

**Blocks (16):** 1 hero · 2 hero-slider · 3 cta · 4 testimonial-carousel · 5 logo-reel · 6 faq-accordion ·
7 image · 8 phone_number · 9 crm_form · 10 split-hero · 11 feature-grid · 12 stats-band · 13 rich-footer ·
14 nav-bar · 15 announcement-bar · 16 rich-text (renderer-local).
Each audited across: Zod schema, render component, inline-edit affordance (Editable/data-field),
AI-catalog entry (`src/server/ai/catalog.ts`), template presence (`db/templates/*.ts` grep, counts below).

**Support/seam units (24):** 17 manifest.ts · 18 package index.ts (VERSION/exports) · 19 registry.ts +
`src/blocks/index.ts` wiring · 20 types.ts (Block/BlockRegistryEntry) · 21 validate.ts ·
22 editable-fields.ts (+buildUrlValues) · 23 zod-introspect.ts · 24 editable.tsx · 25 media-context.tsx ·
26 render-hydration.ts · 27 BlockRenderer.tsx (+Wrap) · 28 BlockError/UnknownBlock · 29 ai/catalog.ts ·
30 button · 31 carousel · 32 accordion · 33 card · 34 slot+cn · 35 feature-grid/icons.tsx ·
36 rich-footer/social-icons.tsx · 37 styles.css + package tailwind.config · 38 packaging
(package.json/tsup/publish.sh/README) · 39 cloudbuild-components.yaml · 40 test suite
(blocks/manifest/build-artifacts tests + vitest configs).

**Template usage (mechanical, `grep 'type: "…"' db/templates/*.ts`):** rich-text 47 · hero 43 · cta 36 ·
rich-footer 29 · nav-bar 29 · feature-grid 21 · split-hero 14 · stats-band 12 · phone_number 11 ·
crm_form 11 · faq-accordion 7 · announcement-bar 4 · image 2 · hero-slider 1 ·
**testimonial-carousel 0 · logo-reel 0** (logo-reel darkness = known D719; testimonial-carousel → D1224).

## Lenses (L = 20)

1 Terminality · 2 Structure/Grain · 3 Organization · 4 Provenance→Consumption · 5 Comprehension ·
6 State-Visibility · 7 Honesty · 8 Reversibility/Safety · 9 Idempotence/Accretion · 10 Failure/Recovery ·
11 Precondition/Forward-path · 12 Population/Dark · 13 Sibling-Coherence · 14 Gating-Axis ·
15 Temporal-Integrity · 16 Cost/Value · 17 Contract-Stability · 18 Naming/Least-astonishment ·
19 Accessibility · 20 Responsive.

## Ledger — blocks 16 × 20 (P pass · Dnnnn directive · n = n/a; no blanks)

| Block | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hero | P | P | P | P | P | P | P | P | P | P | D1204 | P | P | n | P | P | P | D1207 | P | P |
| hero-slider | D1200 | P | P | D1206 | P | P | D1200 | P | P | P | P | P | D1208 | n | P | P | P | P | D1210,D1211 | P |
| cta | P | P | P | P | P | P | P | P | P | P | D1204 | P | P | n | P | P | P | D1207 | P | P |
| testimonial-carousel | D1200 | P | P | P | P | P | D1200 | P | P | P | P | D1224 | D1208 | n | P | P | P | P | D1210 | D1219 |
| logo-reel | P | P | P | P | D1216 | P | P | P | P | D1218 | P | P | D1208 | n | P | P | P | P | D1209 | D1219 |
| faq-accordion | D1200 | P | P | P | P | P | D1200 | P | P | D1218 | P | P | P | n | P | P | P | P | D1200 | P |
| image | P | P | P | P | P | P | P | P | P | P | P | P | P | n | P | P | P | P | P | P |
| phone_number | P | P | P | P | D1215 | P | P | P | P | P | P | P | P | P | P | P | P | D1207 | P | P |
| crm_form | P | P | P | P | P | P | P | D1201 | P | D1218 | P | D1212 | P | D1201 | P | P | P | D1207 | P | P |
| split-hero | P | P | P | P | P | P | P | P | P | P | D1204 | P | P | n | P | P | P | D1207 | P | P |
| feature-grid | P | P | P | D1202 | P | P | P | P | P | D1202,D1205 | D1205 | P | P | n | P | P | P | P | P | P |
| stats-band | P | P | P | P | P | P | P | P | P | D1205 | D1205 | P | P | n | P | P | P | P | P | P |
| rich-footer | P | P | P | D1206 | P | P | P | P | P | P | P | P | P | n | P | P | P | P | P | P |
| nav-bar | P | P | P | P | P | P | P | P | P | P | D1204,D1205 | P | P | n | P | P | P | P | P | D1219 |
| announcement-bar | P | P | P | P | P | P | P | P | P | P | D1204 | P | P | n | P | P | P | P | P | P |
| rich-text | P | P | D1223 | P | P | P | P | P | P | P | P | P | P | n | D1223 | P | P | P | P | P |

Known-issue cells kept as P-with-note (NOT re-reported): split-hero/nav-bar Sibling-Coherence hydration
(D901); rich-text Reversibility XSS (D1109); crm_form/phone_number AI-catalog preconditions (D1114);
crm_form template endpoints (D700); logo-reel template darkness (D719); image empty-in-templates (D712).

## Ledger — support units 17–40

Encoding: every cell **pass** unless listed; A+R (lenses 19–20) are **n/a** on the 13 non-visual units
(17–23, 25, 26, 29, 38, 39, 40); all other cells filled pass. Exceptions:

- 17 manifest — 2:D1217 (category pseudo-enum) · 7:D1201 (requiresEditorWrapper promise) · 17:D1213
- 18 package index — 17:D1213 (VERSION hand-duplicated vs package.json)
- 19 registry/wiring — 15:D1223 (stale "pending Phase 5 / Puck" plan comments)
- 20 types.ts — 7:D1203 (children promise) · 17:D1213
- 21 validate.ts — 7:D1203 (children `z.array(z.unknown())` — never validated)
- 22 editable-fields — 13:D1203 (buildUrlValues walks top-level only; collectAssetIds walks children)
- 23 zod-introspect — all pass
- 24 editable.tsx — 7:D1204 (affordance invites states schemas reject)
- 25 media-context — all pass
- 26 render-hydration — 7:D1214 · 15:D1214 (site-scoped query vs cross-site template capture doc)
- 27 BlockRenderer — 6:D1221 · 12:D1203 (children never rendered) · 14:D1201 (no isEditorPreview inject)
- 28 BlockError/UnknownBlock — 6:D1221 (silent-vs-visible keyed to NODE_ENV, not public-vs-editor)
- 29 ai/catalog — 4:D1202 (curated icon keys invisible to model)
- 30 button — all pass (focus-visible ring, Slot asChild correct)
- 31 carousel — 1:D1200 · 19:D1210 (no accessible name, no pause, no slide position)
- 32 accordion — 1:D1200
- 33 card / 34 slot+cn — all pass
- 35 icons.tsx — 10:D1202 (unknown name → literal word rendered)
- 36 social-icons — all pass (aria-labels via socialLabel)
- 37 styles/tailwind — 19:D1209 (reduced-motion strands off-viewport logos); CSS delivery = known D917
- 38 packaging — 7:D1220 (README false claims) · 17:D1213
- 39 cloudbuild-components.yaml — 11:D1222 · 14:D1222
- 40 tests — all pass (data-field contracts, manifest shape, build artifacts; noted: jsdom-only testing is
  why D1200 was never caught — no SSR-string assertion exists)

**Cell accounting:** 40 × 20 = **800 cells, 100% filled, 0 blank**. Directive-flagged cells 70
(44 block + 26 support) · n/a 39 (13 block Gating cells + 26 support A/R cells) · passes 691.

## Directives (Part 1: D1200–D1224)

- [D1200] (faq-accordion, hero-slider, testimonial-carousel, carousel+accordion primitives × Terminality/Honesty/Accessibility) — «A block must not promise interactivity the delivery pipeline cannot execute.» Instance: «published pages ship ZERO client JS ("no client-side hydration", src/server/render-page.tsx:30) yet faq-accordion is Radix (JS-only) and both carousels are Embla (JS-only); VERIFIED by SSR-rendering the built package: FAQ answer text is ABSENT from the HTML (all items `data-state="closed"`, content unmounted — invisible to visitors AND search engines), hero-slider renders its 2 arrow buttons `disabled`; every live site's FAQ (7 template uses) is a list of dead buttons and every slider is frozen on slide 1.» Fix-class: «either ship a tiny islands/hydration runtime for the 3 interactive blocks, or rebuild them JS-free (native `<details>` accordion; scroll-snap carousel) — the `<details>` route is smallest.»
- [D1201] (crm_form + BlockRenderer + manifest × Reversibility-Safety/Gating) — «A flag that exists to keep live embeds out of the editor must have a consumer.» Instance: «`requiresEditorWrapper: true` (crm-form/index.ts:12) is consumed by NOTHING — `buildPuckConfig` doesn't exist (grep: only doc comments, types.ts:40, manifest.ts:30) and BlockRenderer.tsx:53 passes `parsed.data` only, so the Studio edit preview renders the LIVE `embed_code` via dangerouslySetInnerHTML (CrmForm.tsx:43) — embedded scripts execute in the editor iframe (it must allow scripts for overlayJs), violating the block's own D-006 constraint; the `isEditorPreview` placeholder branch (CrmForm.tsx:20-37) is dead code.» Fix-class: «BlockRenderer injects `isEditorPreview: editable && entry.requiresEditorWrapper` into props.»
- [D1202] (feature-grid + icons.tsx + ai/catalog × Provenance→Consumption/Failure) — «A dual-purpose field's valid vocabulary must reach every author.» Instance: «`icon` accepts 10 curated names, else renders the raw string verbatim (icons.tsx:124-131); the curated list appears in NO schema description, NOT in the AI JSON-schema (plain `string` maxLength 40), and templates already lost the bet — nonprofit.ts:131,136,141,489,499 uses "book","sun","home","dollar","briefcase" → live materialized sites print the literal WORDS inside the accent icon squares.» Fix-class: «`.describe()` listing curated keys on the schema (flows into AI catalog automatically) + add the 5 missing glyphs used by nonprofit.»
- [D1203] (Block.children × Honesty/Population/Sibling-Coherence) — «A persisted field is real everywhere or nowhere.» Instance: «`children?: Block[]` (types.ts:16) is walked by collectAssetIds (render-hydration.ts:33-35), IGNORED by validateBlocks (validate.ts:20 `z.array(z.unknown())` — nested blocks can be arbitrary garbage), IGNORED by buildUrlValues (editable-fields.ts:84 top-level loop), and NEVER RENDERED by BlockRenderer (BlockRenderer.tsx:26-56 has no children recursion) — three consumers, three different answers, zero rendering.» Fix-class: «delete `children` from the Block type until containers exist (or one shared recursive walker + renderer support).»
- [D1204] (hero.title, cta.heading/button_label, split-hero.heading, nav-bar.brand_name, announcement-bar.text × Precondition ∧ editable.tsx Honesty) — «An edit affordance must not invite a state the contract rejects.» Instance: «Editable renders empty-state placeholders inviting clearing ("Add a button label…", editable.tsx:59-65) but these fields carry `.min(1)` — a cleared title fails validateBlocks on save AND, for any legacy/agent-written empty value, safeParse fails at render and the ENTIRE block vanishes silently in prod (BlockRenderer.tsx:37-48 + BlockError silent).» Fix-class: «drop `.min(1)` on defaulted display strings (default already guarantees a sane value) — schema-only change.»
- [D1205] (feature-grid items min3/max6, stats-band stats min2/max5, nav-bar links max7 × Failure/Precondition) — «An array-bounds violation must degrade to a clamped render, never a vanished block.» Instance: «one item added/removed past the bound turns safeParse failure into whole-block disappearance on prod (silent placeholder) — an 8th nav link deletes the site's entire navigation (schemas: feature-grid/schema.ts:30, stats-band/schema.ts:23, nav-bar/schema.ts:30).» Fix-class: «render-side clamp (`.slice(0, max)`) + treat min as authoring guidance; keep bounds as editor validation only.»
- [D1206] (hero-slider, rich-footer columns, faq items, feature items, stats, testimonials, nav links × Provenance→Consumption) — «Every schema field an author owns needs SOME edit surface.» Instance: «since Puck's removal (B5) the only structured editor is the inline overlay, which by design covers TOP-LEVEL strings only (editable-fields.ts:20-21 "Nothing recurses into arrays") — all nested-array content (every FAQ answer, footer link, feature item, stat, slide, testimonial) is editable ONLY via AI chat; hero-slider is the extreme: zero Editable/data-field markers in the entire component (hero-slider/component.tsx), so the catalog's 2nd-listed block has no manual edit path at all.» Fix-class: «per-item data-field markers (e.g. `data-field="items.0.question"`) + overlay support for indexed paths — or an explicit "AI-only fields" doc so the gap is chosen, not accidental.»
- [D1207] (hero/split-hero/cta/phone_number/crm_form × Naming/Sibling-Coherence) — «Sibling blocks name the same concept the same way.» Instance: «hero says `title`/`subtitle`/`cta_label`, split-hero says `heading`/`body`/`primary_cta_label`, cta says `heading`/`body`/`button_label` — three names for each concept the AI must memorize per-block; type keys mix kebab-case (13 blocks) with snake_case (`phone_number`, `crm_form`) (phone-number/index.ts:6, crm-form/index.ts:6).» Fix-class: «canon table in aiHints/catalog now; field aliases at next major.»
- [D1208] (logo-reel.src, testimonial.avatar, hero-slider.image × Sibling-Coherence) — «One image-provenance model per product.» Instance: «four blocks resolve `*_asset_id` through the media pipeline (variants/WebP/alt governance) while logo-reel (schema.ts:4), testimonial avatars (schema.ts:7) and hero-slider's legacy `image` take raw URL strings — bypassing variants, alt stewardship, and enabling hotlinking; this is the root cause of known D719 (no template can author a logo-reel).» Fix-class: «add `*_asset_id` fields with legacy-URL fallback (pattern already proven in hero-slider slides).»
- [D1209] (logo-reel × Accessibility) — «A visual-loop clone is presentation, not content.» Instance: «the marquee doubles the logo list with no `aria-hidden` on the clone half (component.tsx:25,38) — screen readers announce every logo twice; under `prefers-reduced-motion` animation stops (styles.css:33-35) leaving off-viewport logos unreachable inside `overflow-hidden` with no scroll affordance.» Fix-class: «`aria-hidden` wrapper on the second copy + `overflow-x:auto` when reduced-motion.»
- [D1210] (carousel primitive + autoplay consumers × Accessibility) — «Auto-advancing content needs a name and a pause (WCAG 2.2.2).» Instance: «`role="region" aria-roledescription="carousel"` with no aria-label (carousel.tsx:84-92), no slide-position announcement, and Autoplay with no pause control (stopOnInteraction only, hero-slider/component.tsx:68).» Fix-class: «`aria-label` prop threaded from block label + a pause toggle when autoplay; "Slide x of y" visually-hidden text.»
- [D1211] (hero-slider × Accessibility/Sibling) — «A top-of-page hero owns the h1.» Instance: «slide titles are `<h2>` (component.tsx:98) while sibling hero/split-hero emit `<h1>` — a hero-slider-topped page (its aiHints say "Use only at top of page") has no h1 at all.» Fix-class: «first slide h1, rest h2 (or `heading_level` knob).»
- [D1212] (crm_form.label × Population/Dark) — «Every schema field renders somewhere reachable.» Instance: «`label` (schema.ts:5) renders only inside the dead `isEditorPreview` branch (CrmForm.tsx:33) — a field the AI catalog advertises that has never once rendered anywhere.» Fix-class: «render as visually-hidden form name in the live branch (doubles as accessibility win), or drop it.»
- [D1213] (manifest/index/types × Contract-Stability) — «Stored props need a versioned contract.» Instance: «pages persist raw props with no schema version; nothing but hand-discipline prevents a field rename from silently breaking every stored page (hero-slider's `image`→`image_asset_id` shows renames DO happen — survivable only because both fields were kept); `VERSION = "0.6.0"` is hand-duplicated in index.ts:17 vs package.json — one bump forgotten and consumers misreport.» Fix-class: «write an additive-only schema policy into manifest.ts docs + derive VERSION from package.json at build (tsup define).»
- [D1214] (render-hydration × materialize-template × Temporal-Integrity/Honesty) — «A capture flow's storage promise must match the resolver's scoping.» Instance: «materialize-template.ts:19-20 declares "captured blocks keep their source asset_ids … render from immutable URLs. No media copy" — but blocks resolve asset_ids through MediaContext fed by `loadAssetsForBlocks` which filters `WHERE site_id = $1` for the NEW site (render-hydration.ts:63) — any template that ever captures a real image renders missing-placeholders forever on materialized sites (latent today only because templates author empty image blocks, known D712).» Fix-class: «copy referenced media_assets rows at materialize (new ids remapped), or widen hydration to a template-site allowlist.»
- [D1215] (phone_number × Comprehension) — «Comments must describe the runtime that exists.» Instance: «`memo(..., () => true)` "so CTM's DOM swap is never clobbered by a re-render" (PhoneNumber.tsx:5-8,18) guards re-renders that cannot occur — there is no client React anywhere (render-page.tsx:30); the comment encodes a hydration reality the product doesn't have.» Fix-class: «correct comment (and revisit when D1200 introduces real hydration — then the memo becomes load-bearing).»
- [D1216] (logo-reel aiHints × Provenance) — «aiHints reach a content model, not a stylesheet.» Instance: «"Disable speed reductions for users with prefers-reduced-motion" (logo-reel/index.ts:12) instructs the AI about a CSS runtime behavior it cannot influence — noise in every cached prompt.» Fix-class: «delete the sentence; behavior notes live in code comments.»
- [D1217] (manifest.category × Structure/Grain) — «An enum enforced only in a test is a string.» Instance: «`category: string` free-typed; the set {header, content, cta, layout} exists only in manifest.test.ts:15; announcement-bar (top-of-page banner) is "layout" while nav-bar is "header" — picker grouping surprise.» Fix-class: «export `const BLOCK_CATEGORIES` union type; re-home announcement-bar.»
- [D1218] (logo-reel, faq-accordion, crm_form × Failure/empty-props) — «A content-empty block renders nothing in prod, not a blank band.» Instance: «logo-reel default `logos: []` renders an empty py-10 strip; faq-accordion `items: []` renders a floating "Frequently asked questions" heading over nothing; crm_form's schema default `"<form></form>"` (schema.ts:4) renders an invisible empty form — all pass validation and ship blank furniture to live pages.» Fix-class: «prod-mode early-return null when content arrays/embed are empty (mirror Editable's own empty-value rule).»
- [D1219] (testimonial avatar, logo-reel logos, nav-bar logo × Responsive/CLS) — «Every `<img>` declares intrinsic dimensions.» Instance: «avatar (testimonial-carousel/component.tsx:45-49), logos (logo-reel/component.tsx:7-11), nav logo (nav-bar/component.tsx:54-62) render without width/height while sibling image/split-hero set both — layout shift on slow loads, sibling drift.» Fix-class: «width/height attrs (fixed boxes already styled: h-12/h-10/h-8).»
- [D1220] (package README × Honesty) — «Package docs match the package.» Instance: «README.md:44 claims "no embedded SVG icons (Font Awesome via the consumer site)" — feature-grid/icons.tsx and rich-footer/social-icons.tsx are 20 embedded SVGs, deliberately (their own headers say so).» Fix-class: «one-line README correction.»
- [D1221] (BlockRenderer/BlockError × State-Visibility) — «Error visibility keys on audience, not NODE_ENV.» Instance: «`silent = NODE_ENV==="production"` (BlockRenderer.tsx:17) — in the production Studio, the EDITOR's preview also renders failed blocks as invisible `<div data-block-error>` (BlockError.tsx:5-6); an editor whose block vanishes gets zero explanation while a dev-mode public visitor would see the red debug box.» Fix-class: «key on `editable` flag: editor preview always verbose, public always silent.»
- [D1222] (cloudbuild-components.yaml × Precondition/Gating) — «A publish pipeline proves what it ships.» Instance: «tag-triggered publish runs install→build→publish with NO tests, NO typecheck, no assertion that package.json version matches the `components-v*` tag (a v0.7.0 tag happily republishes 0.6.0), and the publish step apt-installs unpinned distro nodejs/npm (line 41) — a different npm than the build step's node:20.» Fix-class: «add test+typecheck step; `node -e` tag-vs-version assert; publish from node:20 image with the token passed in.»
- [D1223] (rich-text placement × Organization/Temporal-Integrity) — «One registry, one home; comments track the live plan.» Instance: «rich-text remains renderer-local "pending Phase 5 (Tiptap + Puck editor)" (src/blocks/index.ts:9-11) — Puck was REMOVED (B5) and the overlay edits rich-text today, so the block's exile rationale and both registries' buildPuckConfig comments describe a deleted future.» Fix-class: «move rich-text into the package (it has no server deps) + sweep Puck references.»
- [D1224] (testimonial-carousel × Population/Dark) — «Every catalog block is exercised by at least one template or has recorded intent.» Instance: «zero of 11 templates use testimonial-carousel (grep db/templates: 0 hits) — with logo-reel (known D719) that's 2 of 16 registry blocks no shipped surface exercises; social-proof is the #1 SMB conversion pattern and the showroom never demonstrates it.» Fix-class: «add testimonials to 2-3 templates (data is authorable — unlike logo-reel it needs no assets).»

## PART 2 — Seam sweep of remaining unit-classes

Coverage check against all 11 prior reports (grep for each candidate class):

| Unit-class | Status | Disposition |
|---|---|---|
| Dockerfile | covered | integrations.md census U68 + D1005 cite lines — no re-audit |
| cloudbuild-components.yaml | UNOWNED | audited (unit 39) → D1222 |
| Legacy pre-pivot SPA (src/pages/{marketing,app,auth}, src/components/marketing+layout+ui, src/stores, src/guards, src/hooks, src/config/site.js·routes.js, src/shared, src/images, src/animations, App.jsx, main.jsx) | UNOWNED | audited → D1290 |
| index.html + public/{images,lottie,models} | UNOWNED | audited → D1290, D1291 |
| vite.config.js | UNOWNED | audited → D1292 |
| scripts/ (provision-site.ts, smoke-test.ts) | UNOWNED | audited → D1293; provision-site passes (mirrors endpoint logic, env documented) |
| docker-compose.yml | UNOWNED | audited: PASS (isolated port 5434, healthcheck, named volume, dev-only creds) |
| vitest.workspace.ts + test infrastructure | UNOWNED | audited: PASS (node/jsdom fork split with documented flake rationale; restoreMocks/unstubGlobals hygiene; package suite isolated) — one gap noted under D1200: no SSR-string test exists anywhere |
| root tailwind/postcss configs | UNOWNED | audited: PASS (content globs correct; they do scan the legacy tree — self-heals when D1290 deletes it) |
| Studio SPA global error boundary | covered | admin-shell U9/D217 |
| packages publishing (publish.sh) | UNOWNED | audited: PASS (token in mktemp outside workspace, trap cleanup, dry-run flag) |
| Docs accuracy (root README, PLAN.md, PHASE-*.md, DECISIONS.md, DEMO-LOG, BLOCKERS, ROUTINE-README, docs/) | DEFERRED | justification: historical narrative with no runtime effect; the live handoff doc is current by construction (written today); spot-checks ran anyway — package README stale (→D1220), README workspace-consumption claim accurate. Risk accepted: stale phase docs can misdirect future agents; recommend a one-shot docs-sweep task, not audit-grade review |
| dist/ (root + package), node_modules, .superpowers | n/a | build artifacts / third-party / audit output |
| db/seed.ts, seed-templates.ts | covered | data-model census (2 seeds) + templates slice |

### Part-2 directives (D1290+)

- [D1290] (legacy Brainfood SPA + assets × Population-Dark/Reversibility-Safety) — «A pivoted repo must not ship its previous product.» Instance: «an entire pre-pivot app rides in prod: 20+ marketing/auth/app pages (src/App.jsx:12-46 imports them all), Zustand auth stores, guards, `src/config/site.js` Brainfood branding — and 11 MB of assets VERIFIED LIVE right now: `https://studio.anchorcorps.com/images/team-photos/charles1.webp` → 200 (147 KB photo of a real person, 33 such files) and `/images/logo/BRAINFOOD%20ICON.svg` → 200, served by `express.static(dist)` (index.ts:38) on the product's origin; App.jsx serves the full legacy app to any non-admin host reaching the SPA fallback (isAdminHost branch, App.jsx:45-46).» Fix-class: «delete src/pages, src/components/{marketing,layout,ui}, src/stores, src/guards, src/config/site.js, src/shared, src/images, src/animations, public/images|lottie|models; make main.jsx render AdminApp only.»
- [D1291] (index.html × Honesty/Comprehension) — «The product's own HTML shell is not template debris.» Instance: «Studio ships `<title>Site Template</title>`, meta description "Lorem ipsum dolor sit amet…", NO favicon, and three Google-Fonts families fetched from a third party on an authenticated admin surface (index.html:6-10).» Fix-class: «real title/description/favicon; self-host the one UI font.»
- [D1292] (vite.config alias × Naming) — «Dead aliases mislead every reader.» Instance: «`"@my-app/shared" → src/shared/index.js` stub (vite.config.js:13) exists solely to feed the legacy tree's auth pages — prior-template residue keeping a fake package name alive.» Fix-class: «falls out with D1290; delete alias + stub.»
- [D1293] (scripts/smoke-test.ts × Terminality) — «A post-migration smoke test asserts the site RENDERS, not just that scripts are present.» Instance: «checks DB row, SSL status, CTM/analytics script presence, CRM id — never that the page body contains a single block; a site rendering an empty `<main>` passes all green (smoke-test.ts:8-14).» Fix-class: «add one assertion: rendered HTML contains ≥1 `ac-` block class.»

## Five most severe (verbatim)

1. D1200 — dead interactivity on every published site (FAQ answers not even in the HTML; verified by SSR render).
2. D1290 — previous product + 147 KB photos of real people live on studio.anchorcorps.com right now (verified 200).
3. D1201 — live CRM embed executes inside the Studio editor preview; the guard flag has no consumer; D-006 violated.
4. D1206 — post-Puck, all nested-array content (FAQs, footers, features, stats, slides) is editable only via AI chat; hero-slider has no manual edit path at all.
5. D1202 — templates already ship literal words ("book", "sun", "dollar"…) where icons should be, because the curated icon vocabulary reaches neither authors nor the AI.
