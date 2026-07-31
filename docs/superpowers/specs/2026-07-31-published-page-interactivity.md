# Published-page interactivity for faq-accordion, hero-slider, testimonial-carousel (D1200 / W1.8)

**Date:** 2026-07-31
**Directive:** D1200 — «A block must not promise interactivity the delivery pipeline cannot execute.»
**Evidence:** docs/superpowers/audits/2026-07-30-product-audit/blocks-critic.md

## Problem

Published tenant pages are `renderToString` output with zero client JavaScript
(src/server/render-page.tsx). Three registry blocks are built on JS-only
libraries:

- `faq-accordion` — Radix accordion. SSR emits every item `data-state="closed"`
  with the answer **unmounted**: answers are absent from the HTML (invisible to
  visitors AND search engines) and the question buttons are dead.
- `hero-slider`, `testimonial-carousel` — Embla. SSR emits all slides in a flex
  row inside `overflow-hidden` with both arrow buttons `disabled`; live sites
  are frozen on slide 1.

7 of 11 seeded templates use `faq-accordion`, 8 use `testimonial-carousel`,
1 (fitness-studio) uses `hero-slider` — every seeded site ships at least one
broken-interactivity block.

## Premise corrections (verified against the code, per the standing rule)

The W1.8 brief carried two wrong premises; both were checked and both tilt the
decision further toward JS-free:

1. **"The sandboxed preview iframe allows scripts" — false.** The draft-preview
   route (src/server/routes/admin-pages.ts:503-510) and the template-preview
   route (src/server/routes/templates.ts:~596-601) both set
   `script-src 'none'` (the editable variant allows only the overlay's nonce).
   `sandbox allow-scripts` is present, but CSP blocks every page script. No
   block JS runs in any preview today.
2. **"In the Studio editor/preview (client React) they work" — false.** No
   client-React path renders blocks anywhere: the admin SPA never imports
   `@anchorcorps/components` block components (verified by grep across
   src/admin, src/client, src/main.jsx); the Studio workspace embeds the SSR'd
   preview iframe, and inline editing is a nonce-scoped overlay script over
   that same SSR HTML (`EditModeProvider` is applied **server-side**,
   render-page.tsx:330-333). Radix/Embla interactivity currently functions
   **nowhere in the product** — only inside jsdom unit tests. There is no
   working editor behavior to preserve by hydrating; "parity" means making all
   three SSR surfaces (live, preview, editable preview) behave identically.

## Options evaluated

### (a) JS-free rebuilds everywhere

Native `<details>/<summary>` for FAQ; CSS scroll-snap for carousels.

- Fidelity, FAQ: **full** — native disclosure toggling works in every browser
  with zero JS; the `name` attribute gives exclusive-open (`multiple: false`)
  natively in all evergreen browsers (Chrome 120+, Safari 17.2+, FF 130+),
  degrading harmlessly to multi-open on older ones. Answers are real DOM →
  SEO complete.
- Fidelity, carousels: **partial** — scroll-snap gives swipe (touch),
  trackpad scroll, and scrollbar dragging natively, but CSS cannot implement
  arrow buttons, looping, or the schema's `autoplay`/`interval_ms` knobs, and
  desktop mouse users get almost no affordance to reach slide 2.
- Parity: perfect (identical behavior under `script-src 'none'`).
- Payload: ~0.
- Maintenance: lowest.

### (b) Islands/hydration runtime

Ship the package's React components + a hydration bootstrap to tenant pages.

- Fidelity: full (whatever jsdom tests exercised).
- Cost: introduces the first client bundle to tenant pages — a build/publish
  pipeline for versioned client assets, `render-page.tsx` shell changes,
  serving routes, cache-busting, and CSP work; React runtime ≈45KB gz per
  page for two widgets. Preview parity additionally requires unblocking
  scripts in both preview routes. Grossly disproportionate to the need.

### (c) Hybrid — JS-free structure + one tiny vanilla-JS island for carousels

FAQ per option (a). Carousels: scroll-snap viewport as the base (option (a)),
plus a single ~1.5KB inline vanilla-JS island the carousel primitive emits in
its own SSR output, which progressively enables arrows, loop wrap-around, and
autoplay by driving `scrollTo` on the snap container.

- Fidelity: full — swipe works with zero JS; arrows/loop/autoplay work where
  the island runs.
- No dead controls, ever: arrows are hidden by CSS until the island marks the
  root `data-ac-ready`. Where scripts cannot run, the carousel is a clean
  swipeable scroll-snap strip — degraded affordance, never a lying control.
- Parity: live pages already permit the island (`script-src 'unsafe-inline'`
  in src/server/csp.ts). Preview routes currently say `script-src 'none'`;
  adding the island's **sha256 hash** to both preview CSPs allows exactly
  that one script and nothing else, making live, plain preview, and editable
  preview behave identically. (Hashes coexist with the editable route's
  nonce; the global `buildCsp` is untouched — adding a hash there would
  disable its `'unsafe-inline'` and break analytics/CTM/vitals inline tags.)
- Payload: ~1.5KB inline, no requests, no build pipeline, no framework.
- Maintenance: one framework-free script string, unit-testable; the CSP hash
  is computed from the exported constant at server module load, so it can
  never drift from the script.

## Decision

**Option (c).** FAQ is rebuilt fully JS-free on `<details>/<summary>` (the
brief's bias holds — fidelity survives completely). For carousels the bias's
own escape hatch applies: scroll-snap alone genuinely cannot deliver arrows,
looping, or the schema-promised `autoplay`, so the minimal inline island
(<2KB, CSP-compatible via hash, framework-free, progressive-enhancement-only)
carries exactly those three behaviors and nothing else.

## Design

### faq-accordion

- Primitive `src/primitives/accordion.tsx` rewritten (same component names —
  `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` — new
  JS-free contract): `Accordion` renders a wrapper and provides
  `{ name?: string }` context (a `React.useId()`-derived group name when
  `multiple` is false); `AccordionItem` renders `<details name=…>`;
  `AccordionTrigger` renders `<summary>` (default marker suppressed, chevron
  rotates via `details[open]` CSS); `AccordionContent` renders a plain div.
- Answers are always in the SSR HTML. `multiple: false` → shared `name`
  (exclusive open); `multiple: true` → no `name`.
- Edit mode (`EditModeContext`): every item renders `open` and the group
  `name` is dropped, so editors see all answers at once; toggling still works.
  (Only `heading` is inline-editable — editable-fields map unchanged.)
- Schema unchanged.

### Carousel primitive (shared by hero-slider + testimonial-carousel)

- `src/primitives/carousel.tsx` rewritten (same exported names, no Embla, no
  context-driven state): `Carousel` renders the `role="region"` root with
  `data-ac-carousel`, optional `data-loop` / `data-autoplay="<ms>"`, its
  children, and one inline `<script>` containing `CAROUSEL_ISLAND_JS`;
  `CarouselContent` renders the scroll-snap viewport
  (`overflow-x-auto snap-x snap-mandatory`, `data-ac-viewport`, `tabindex=0`);
  `CarouselItem` renders a full-width `snap-start` slide
  (`role="group"`, `aria-roledescription="slide"`); `CarouselPrevious`/
  `CarouselNext` render `data-ac-prev`/`data-ac-next` buttons hidden by CSS
  until `data-ac-ready`.
- The island (exported constant `CAROUSEL_ISLAND_JS`): initializes every
  `[data-ac-carousel]:not([data-ac-ready])` (idempotent — safe when multiple
  carousel blocks each emit the tag), wires arrows via `scrollTo` with
  wrap-around when `data-loop`, maintains arrow `disabled` state on scroll
  when not looping, and runs autoplay when `data-autoplay` is set — skipped
  under `prefers-reduced-motion`, skipped in the inline editor
  (`window.__AC_EDIT_BOOT__`), stopped permanently on first user interaction
  (pointer/wheel/key inside the root — Embla `stopOnInteraction` parity).
  Defensive: whole body in try/catch, feature-checked, no-ops in jsdom.
- Native keyboard/scroll behavior: the viewport is a focusable scroll
  container, so arrow keys scroll it without any JS.
- Blocks `hero-slider` / `testimonial-carousel` keep their schemas and their
  section markup; they pass `loop`/`autoplayMs` to `Carousel` instead of
  Embla plugins. Arrows still render only when there is more than one slide.

### CSP (previews only)

- Package exports `CAROUSEL_ISLAND_JS`; the server computes
  `'sha256-<base64>'` from it once at module load (`src/server/csp.ts` gains
  the helper + constant next to `buildCsp`).
- Draft-preview route: plain variant `script-src 'none'` →
  `script-src '<hash>'`; editable variant `script-src 'nonce-…'` →
  `script-src 'nonce-…' '<hash>'`.
- Template-preview route: same `'none'` → `'<hash>'` swap.
- The global `buildCsp` (live pages) is unchanged.

### CSS (`packages/components/src/styles.css`)

- FAQ: suppress `summary` markers, chevron rotation on `details[open]`.
- Carousel: scrollbar hiding on the viewport, arrows hidden until
  `[data-ac-ready]`.

## Tests (TDD)

- Package (jsdom + `renderToString`):
  - SSR-string tests (the audit's named gap): `renderToString(<FaqAccordion…>)`
    contains every answer text, `<details`/`<summary`, no `data-state`;
    exclusive vs multiple `name` behavior; `renderToString(<HeroSlider…>)` /
    `(<TestimonialCarousel…>)` contain all slide/quote text, the island
    script, `data-loop`/`data-autoplay` wiring, and no `disabled` arrows at
    SSR time; **no framework-runtime dependency for interaction** — the SSR
    string's interactive elements are `<details>`/`<summary>` and
    `data-ac-*` hooks the island drives, with no React ids/handlers required.
  - Primitive tests rewritten for the native contracts (details toggling via
    jsdom's native `<details>`, ARIA roles preserved, arrow labels, island
    emission + idempotence guard).
  - Edit-mode tests: FAQ items all `open` under `EditModeProvider`; heading
    `data-field` markers unchanged for both carousels + FAQ.
- Server: CSP hash matches `sha256(CAROUSEL_ISLAND_JS)`; preview routes emit
  the hash (plain + editable + templates).
- Template compat: all 11 seeded templates' `faq-accordion` /
  `testimonial-carousel` / `hero-slider` usages parse + render through the
  new components without template edits (schemas unchanged).

## Out of scope (deferred)

- D1210/D1211 (carousel accessible names, pause control, slide-position
  indicator) — dots/status remain a follow-up; this spec ships arrows only,
  matching the current UI surface.
- D1215 (PhoneNumber memo comment) — separate directive.
- Open/close animation for `<details>` (CSS `interpolate-size` is not yet
  cross-browser; instant toggle is acceptable and honest).
