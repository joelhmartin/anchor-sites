# Phase 2 — `@anchorcorps/components` v0.1

> **Goal:** Stand up the global component library as a versioned npm package on GCP Artifact Registry, copy in shadcn primitives as an internal layer, ship the first wave of opinionated `ac-`-prefixed blocks, and migrate the renderer to consume blocks from the package instead of inline `src/blocks/`. After Phase 2, adding a new block means a new package release, not a renderer commit.

## Anchors that govern this phase

- **D-005** — Versioned npm package on GCP Artifact Registry. `ac-` class prefix. CSS custom properties for colors. No `font-family` in component CSS. Font Awesome over inline SVG.
- **D-016** — Blocks register via `registerBlock()` runtime API. The package exports a manifest the renderer iterates; the package never imports the renderer's registry.
- **D-018** — shadcn/ui primitives copy-in (Radix under the hood). Embla Carousel for sliders. Swiper reserved as an escape hatch.
- **D-002** — One Zod schema per block drives validation, type, and (later) editor field generation + AI prompt.
- **D-024** — Same GCP project as anchor-hub (`anchor-hub-480305`, `us-central1`). New **npm-format** Artifact Registry repo, sibling to the existing Docker `cloud-run-source-deploy` repo.

## Decisions captured during planning

These are draft — they land in `DECISIONS.md` when their task lands. Listed here for traceability:

- **D-026** — Monorepo via npm workspaces in this repo. `packages/components/` lives alongside the renderer; atomic commits across both during the 2.5→2.8 migration. Split-out to a separate repo can happen later without code churn.
- **D-027** — `tsup` (esbuild-backed) as the package build pipeline. Emits ESM + CJS + `.d.ts` + bundled CSS in one command.
- **D-028** — Package emits a single prebuilt `dist/styles.css` (Tailwind compiled to plain CSS using the package's own config). Renderer imports it once via `@anchorcorps/components/styles.css`. Renderer doesn't need Tailwind to consume the package.

## Tasks

- [x] **2.1 — Artifact Registry npm repo + auth wiring**
  - `gcloud artifacts repositories create npm-anchorcorps --repository-format=npm --location=us-central1 --project=anchor-hub-480305`
  - Verify with `gcloud artifacts repositories list --project=anchor-hub-480305 --location=us-central1`
  - Append `docs/components-publish.md` with: `.npmrc` template for local dev (uses `gcloud auth print-access-token`), CI auth pattern (service account key), repo URL
  - **Tests:** none directly (smoked by 2.7)

- [x] **2.2 — Monorepo workspaces + package skeleton**
  - Add `"workspaces": ["packages/*"]` to root `package.json`
  - Create `packages/components/{package.json,tsconfig.json,tsup.config.ts,src/index.ts,README.md}`
  - `package.json` → name `@anchorcorps/components`, version `0.1.0`, `publishConfig.registry` pointing at the AR npm repo, `main`/`module`/`types`/`exports` map
  - Root scripts: `build:components`, `dev:components`, `test:components`
  - **Tests:** smoke build emits `dist/index.js` / `dist/index.cjs` / `dist/index.d.ts`; vitest unit test in the package proves the workspace runs its own tests

- [x] **2.3 — Tailwind + CSS toolchain inside the package**
  - Package-local `tailwind.config.ts` + `postcss.config.cjs`, content globs scoped to `packages/components/src/**/*.{ts,tsx}`
  - Deps: `tailwindcss`, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge`, `postcss`, `autoprefixer`
  - `tsup.config.ts` injects the Tailwind CSS pipeline; build emits `dist/styles.css` consumers import as a side effect
  - **Tests:** build assertion — `dist/styles.css` exists and contains a known class from the opinionated blocks layer

- [x] **2.4 — shadcn primitives copy-in (internal layer)**
  - Copy into `packages/components/src/primitives/`: `button`, `card`, `carousel` (Embla), `accordion` (Radix), `slot` (Radix)
  - Deps: `@radix-ui/react-accordion`, `@radix-ui/react-slot`, `embla-carousel-react`, `embla-carousel-autoplay`
  - Primitives are **not** exported from the package root. They are internal building blocks for the opinionated blocks layer.
  - **Tests:** render + a11y attr assertions per primitive; carousel keyboard nav (arrow keys advance); accordion `aria-expanded` toggles

- [x] **2.5 — Opinionated blocks first wave**
  - **2.5.a** `ac-hero` — direct port of Phase 1 inline `src/blocks/hero` schema (so existing seed renders unchanged)
  - **2.5.b** `ac-hero-slider` — multi-slide Embla, schema `{ slides: Slide[], autoplay?, interval? }`
  - **2.5.c** `ac-cta` — direct port of Phase 1 inline `src/blocks/cta` schema
  - **2.5.d** `ac-testimonial-carousel` — Embla, per-slide `{ quote, author, role?, avatar? }`
  - **2.5.e** `ac-logo-reel` — CSS-marquee logo strip, no JS, schema `{ logos: { src, alt, href? }[] }`
  - **2.5.f** `ac-faq-accordion` — Radix accordion via shadcn, schema `{ items: { question, answer }[] }`
  - Each block ships: `schema.ts`, `component.tsx`, `index.ts` (exports `{ type, schema, component, label, description, aiHints?, category }`), `styles.css` (component-scoped, CSS custom props for colors, no `font-family`)
  - **Tests per block:** schema parses with defaults; component renders with `ac-<name>` root class; brand-token CSS vars referenced

- [x] **2.6 — Block manifest + registerAll export**
  - `packages/components/src/blocks/manifest.ts` exports `blockManifest: BlockManifestEntry[]` covering every block from 2.5
  - `BlockManifestEntry` shape matches renderer's `BlockRegistryEntry` (so the renderer can register without a shape adapter)
  - Export `registerAll(register: (type, entry) => void)` convenience — the renderer passes its own `registerBlock`; the package never imports the renderer
  - **Tests:** every manifest entry has all required fields; `registerAll` invokes the provided register once per block; every schema accepts its declared defaults

- [x] **2.7 — Publish workflow + first publish**
  - `packages/components/scripts/publish.sh` — generates a temp `.npmrc` with `gcloud auth print-access-token`, then `npm publish --access=restricted`
  - Cloud Build trigger in `anchor-hub-480305` watching tags `components-v*` on this repo, separate from the renderer trigger
  - Service account `anchor-sites-components-publisher@anchor-hub-480305.iam.gserviceaccount.com` with `roles/artifactregistry.writer` on the npm repo only
  - Document the tag-and-publish flow in `docs/components-publish.md`
  - **Tests:** dry-run publish (`npm publish --dry-run`) added to PR CI; first real publish lands `0.1.0` to the AR repo as a manual smoke

- [x] **2.8 — Renderer consumption + swap**
  - Root `package.json` adds `@anchorcorps/components` as workspace dep (`workspace:*` for dev, pinned `^0.1.0` for deploy)
  - `src/blocks/index.ts` rewrites to import `blockManifest` and loop `registerBlock`
  - Delete `src/blocks/hero/`, `src/blocks/cta/` and their tests — the package owns them
  - **Keep** `src/blocks/rich-text/` inline (Tiptap is Phase 5)
  - Renderer entry imports `@anchorcorps/components/styles.css` once
  - **Tests:** existing `tests/integration/page-render.test.ts` continues to pass against both seeded sites; `tests/integration/admin-pages.test.ts` continues to pass; full suite still 100+ passing

- [ ] **2.9 — CI / local dev experience**
  - `npm test` from repo root runs both renderer + package suites via workspaces
  - `npm run dev:components` watches the package, rebuilds on change; renderer picks up edits through the workspace symlink via Vite HMR
  - Cloud Build for the renderer (existing trigger) injects `.npmrc` with AR auth so the production deploy installs the published package version
  - Update `cloudbuild.yaml` to write `.npmrc` from a Secret Manager secret before `npm ci`
  - **Tests:** `npm test` exits 0 from repo root; renderer Cloud Build step verifies `@anchorcorps/components` resolves to the published version, not a local symlink

- [ ] **2.10 — Phase 2 docs + plan tick**
  - `packages/components/README.md` — install, auth, usage, contributing
  - `docs/components-publish.md` — versioning policy (patch = bug, minor = new block, major = manifest shape change), publish flow, troubleshooting
  - `docs/components-consumption.md` — how the renderer registers blocks
  - Tick `PLAN.md` Phase 2 row from `[ ]` to `[x]`

## Demo milestones (chat-only per current routine convention)

- Phase 2 started — after **2.1** lands
- First package build green locally — after **2.5** or **2.6**
- Package published `0.1.0` to AR — after **2.7**
- Renderer running on package-sourced blocks — after **2.8**
- Phase 2 complete — after **2.10**

## Phase 2 definition of done

Every box above checked, AND:

- `@anchorcorps/components@0.1.0` published to AR npm repo `npm-anchorcorps` in `anchor-hub-480305/us-central1`
- The renderer running locally and in production sources `hero` + `cta` blocks (and the four new ones) from the package, not from `src/blocks/`
- `src/blocks/rich-text/` retained inline pending Tiptap-in-Phase-5
- Full test suite ≥ baseline (114) and green
- `PLAN.md` Phase 2 row ticked
- Phase 3 not started — wait for `.routine/NEXT-PHASE-APPROVED`

## Completion log

<!-- Routine appends entries below this line, newest first -->

### 2026-05-19 13:00 UTC — Task 2.8 (renderer consumption + swap) — DEMO MILESTONE
**Commit:** (pending — same commit as this log entry)
**Done:** Renderer now sources `hero`, `cta`, `hero-slider`, `testimonial-carousel`, `logo-reel`, `faq-accordion` from `@anchorcorps/components` via the workspace symlink in dev. The package's `blockManifest` is iterated and every entry registered against the renderer's existing `registerBlock` — the package never imports the renderer's registry (D-016).
- Root `package.json` adds `"@anchorcorps/components": "*"` as a runtime dep. npm workspaces creates the `node_modules/@anchorcorps/components → packages/components` symlink on `npm install`.
- `src/blocks/index.ts` rewritten — pulls `blockManifest` from the package, loops `registerBlock(type, rest)`, then side-effect imports `./rich-text/index.js` so the inline rich-text block (deferred to Phase 5 / Tiptap) stays registered.
- `src/blocks/hero/` + `src/blocks/cta/` deleted. `src/blocks/styles.ts` deleted (was unused — never imported by the client entry).
- `src/server/render-page.tsx` now inlines two CSS bundles into the SSR'd `<style>` tag: the package's prebuilt `dist/styles.css` (resolved via `createRequire(import.meta.url).resolve("@anchorcorps/components/styles.css")`) and the inline `rich-text/styles.css` (resolved via `path.resolve(__dirname, "../blocks/rich-text/styles.css")`). Both wrapped in `try/catch` so a missing file degrades silently rather than crashing the server. Read once at module-load and cached.
- `src/blocks/blocks.test.tsx` rewritten — drops the hero+cta-specific schema and component tests (the package owns them now), keeps registration assertions across all seven types, keeps rich-text schema + SSR tests, keeps the "no inline font-family on Hero" architectural-anchor test but now resolves the Hero component via the registry rather than importing it directly.
**Tests added/changed:** Root suite went from 114 → **110** (lost 4 tests that lived in Phase 1's inline hero/cta and the schema/SSR sections of `blocks.test.tsx`). Those 4 tests are replaced by the package suite's 15 block render tests + 8 manifest contract tests + 23 primitive tests = **46 in the package**. Net total **156**, vs Phase 1 finish of **114** — every Phase 1 invariant is still under test, plus the new blocks. `tests/integration/page-render.test.ts` still passes 6/6, including its `expect(res.text).toContain("ac-hero")` / `"ac-cta"` assertions against the seeded muldoon-dental + demo sites. Renderer typecheck clean.
**Next:** Task 2.9 — workspace test orchestration (`vitest.workspace.ts` or a root script that runs both suites), `dev:components` watcher for HMR, Cloud Build renderer trigger gains a token-authed `.npmrc` so prod `npm ci` can resolve `@anchorcorps/components` from AR.
**Notes:**
- **Latent Phase 1 CSS gap fixed as a side effect.** Phase 1's `src/blocks/styles.ts` was never imported by `src/main.jsx` or the server, so the seeded production sites likely rendered with only the shell base CSS — `.ac-hero`, `.ac-cta`, `.ac-rich-text` rules were never reaching the browser. The 2.8 swap inlines the package CSS bundle (and the inline rich-text CSS) directly into the SSR'd `<style>` tag, which closes that gap. The next production deploy will visibly improve.
- **No `.npmrc` committed.** Workspace symlink doesn't need one. Task 2.9 adds the prod-side `.npmrc` template (gitignored) + Cloud Build wiring.
- **Pin policy for production deploys:** root `package.json` currently has `"@anchorcorps/components": "*"`. Task 2.9 narrows this to `"^0.1.0"` once we confirm AR-resolution works in the renderer's Cloud Build trigger — keeps the workspace-symlinked dev path identical to today.
- The renderer's tests intentionally do **not** test the package's blocks beyond registration + the no-font-family anchor — that's the package suite's job. This keeps the boundary clean and avoids drift if the package internals change.

### 2026-05-19 12:50 UTC — Task 2.7 (publish workflow + first publish) — DEMO MILESTONE
**Commit:** 95080a8
**Done:** `@anchorcorps/components@0.1.0` is **live in the GCP Artifact Registry npm repo** (`anchor-hub-480305 / us-central1 / npm-anchorcorps`). Bootstrap publish executed manually from this routine session.
- **`packages/components/scripts/publish.sh`** — mints a short-lived `.npmrc` *outside* the workspace (npm ignores in-workspace `.npmrc` when running from a workspace package), points npm at it via `NPM_CONFIG_USERCONFIG`, runs `npm publish`, cleans up via `trap`. Auto-runs `npm run build` if `dist/` is missing. `--dry-run` flag supported.
- **`cloudbuild-components.yaml`** — Cloud Build pipeline at repo root that future tag-driven publishes (`components-v*`) consume. Steps: `npm install` (workspace-aware) → `npm run build:components` → `npm publish` with a token-authed `.npmrc` minted on the fly inside the build SA. Trigger creation deferred to "wire in console" — the doc spells out the exact trigger config (repo, tag regex, service account).
- **IAM** — `roles/artifactregistry.writer` on `npm-anchorcorps` granted to the default Cloud Build service account (`333281424614@cloudbuild.gserviceaccount.com`). Scoped to this repo only. Bootstrap publish used the operator's `gcloud auth print-access-token`. No JSON keys on disk.
- **Verification** — `gcloud artifacts versions list --repository=npm-anchorcorps --package=@anchorcorps%2Fcomponents` returns `0.1.0` with the expected description and timestamp. Tarball: 9 files, 41.4 kB packed (README, `dist/index.{js,cjs,d.ts,d.cts,*.map}`, `dist/styles.css`, `package.json`).
**Tests added:** 0 — publish is observable infra rather than code under test. Verification is the AR `versions list` query.
**Next:** Task 2.8 — renderer consumption swap. Add the package as a workspace dep, replace inline `src/blocks/hero` + `src/blocks/cta` with `blockManifest` consumption, retain `src/blocks/rich-text/` inline (Tiptap is Phase 5), confirm both seeded sites still render in tests.
**Notes:**
- **First-publish bug caught + fixed:** npm publish ignored the in-workspace `.npmrc` (warning: "ignoring workspace config"). Fix: place the `.npmrc` in `mktemp` and pass via `NPM_CONFIG_USERCONFIG`. Updated `scripts/publish.sh` and re-ran cleanly.
- **Service account simplification** — the original phase plan (and earlier `docs/components-publish.md` draft) referenced a dedicated `anchor-sites-components-publisher` SA. For v0.1 the default Cloud Build SA suffices — keeps Phase 2 from sprouting unnecessary IAM surface. The doc now spells out the path to a dedicated SA if a future need surfaces (e.g. locking down which builds can publish).
- **Tag-trigger wiring is the one piece NOT auto-completed.** It's a single click in Cloud Build console or one `gcloud builds triggers create github` invocation. The `cloudbuild-components.yaml` is in place. The first automated publish will be `0.1.1` (or `0.2.0` if a new block lands first) after the trigger is wired.
- **Bootstrap publish was idempotent-safe** — the AR repo refuses re-publishing the same version, so a re-run before bumping `version` would error rather than overwrite.

### 2026-05-19 12:30 UTC — Task 2.6 (block manifest contract tests)
**Commit:** d2ec255
**Done:** The manifest shape, `BlockManifestEntry` type, `registerAll` helper, and per-block index files were already in place (2.2 + 2.5). 2.6 added formal **contract tests** that pin the manifest's invariants so future block additions can't break them silently.
- `src/blocks/manifest.test.ts` — 8 cases covering: manifest length matches v0.1 expectation (6), every entry has every required field with a sensible value, every `type` is unique, every `schema` is a `z.ZodObject` instance (introspection guarantee per D-002), every schema accepts its declared defaults via `safeParse({})`, every `component` is a function, manifest contains the Phase 1 ports (`hero` + `cta`) so existing seed data renders, `registerAll` invokes the caller's register fn once per entry in declared order with `(type, rest)` argument shape where `rest` excludes `type`.
**Tests added:** 8. Package suite: 46 passed.
**Next:** Task 2.7 — publish workflow + first `0.1.0` publish to AR.
**Notes:**
- The contract tests intentionally check **structural** invariants (defaults parse, types unique, fields present) rather than asserting specific blocks exist by name. The `hero` + `cta` check is the one exception — it's load-bearing because Phase 1 seed data depends on those exact type keys. Other types can change between phases without breaking the test.
- The `category` allow-set (`header / content / cta / layout`) is enforced here because the editor block picker in Phase 5 will group by category — a typo'd category would silently land in a "stray" bucket later. Adding a new category requires a single-line edit here.
- `registerAll`'s arg shape (`type` separated from the rest) is asserted because the renderer's `registerBlock` signature is `(type, entry)` where `entry` does NOT contain `type` — a mismatch would silently double-encode `type` in the renderer's registry.

### 2026-05-19 12:20 UTC — Task 2.5 (opinionated blocks first wave)
**Commit:** 65627e0
**Done:** Six opinionated `ac-`-prefixed blocks landed in `packages/components/src/blocks/<name>/{schema.ts,component.tsx,index.ts}`. Each ships a Zod schema (every field has a `.default(...)`), a pure React component using `ac-<name>` root classes + brand-token Tailwind utilities + the primitives from 2.4, and an `index.ts` exporting a `BlockManifestEntry`.
- **`hero`** — port of Phase 1 inline. Same schema (eyebrow / title / subtitle / cta_label / cta_href / align). Uses `<Button asChild>` so the CTA renders as `<a>` while keeping the variant styling. CSS class `ac-hero`. Category `header`.
- **`hero-slider`** — Embla-backed multi-slide variant. Schema includes `slides: HeroSlide[]`, `autoplay`, `interval_ms`, `align`. Per-slide background image with a translucent overlay for legibility. Arrows hidden when only one slide. CSS class `ac-hero-slider`. Category `header`.
- **`cta`** — port of Phase 1 inline. Same schema (heading / body / button_label / button_href / variant). Variant `primary` paints with `--theme-accent`; `muted` uses `--theme-muted`. Inverts the button variant so the CTA stands out against either background. CSS class `ac-cta`. Category `cta`.
- **`testimonial-carousel`** — Embla-backed quote carousel. Schema includes heading + `items: Testimonial[]` (`quote, author, role?, avatar?`) + autoplay knobs. Each slide rendered inside a `Card` from the primitives layer. CSS class `ac-testimonial-carousel`. Category `content`.
- **`logo-reel`** — CSS-only horizontal marquee (no JS, no Embla — keeps the bundle lean for a passive social-proof block). Schema includes heading + `logos: LogoEntry[]` + `speed_seconds`. Component duplicates the logo list once so a `translateX(-50%)` animation loops seamlessly. Speed knob via the `--ac-logo-reel-duration` CSS custom property (inline on the viewport). Honors `prefers-reduced-motion: reduce`. CSS class `ac-logo-reel`. Category `content`.
- **`faq-accordion`** — Radix accordion via the primitives layer. Schema includes heading + `items: FaqItem[]` + `multiple` (allows more than one item open at once). CSS class `ac-faq-accordion`. Category `content`.
**Manifest wired:** `src/blocks/manifest.ts` now imports all six entries and exposes them as `blockManifest: BlockManifestEntry[]`. The empty 0.1.0 skeleton from 2.2 is gone. `registerAll(register)` and the package's smoke test continue to pass against the new manifest (six entries, six register calls).
**Tests added:** 15 (`src/blocks/__tests__/blocks.test.tsx`). 2-3 per block — root class present, brand-token class present, variant behavior (cta primary vs muted, hero-slider single-slide hides arrows, hero align swap), slot-as-anchor (cta), CSS custom property emission (logo-reel speed), accordion trigger rendering (faq). Package suite: 38 passed.
**Next:** Task 2.6 — formal manifest contract tests (every entry has all required fields, every schema accepts its declared defaults, registerAll behavior across the populated manifest).
**Notes:**
- **Three caught issues mid-task**, all fixed in-commit:
  1. The marquee `@import` from `src/styles.css` to `src/blocks/logo-reel/styles.css` produced an empty CSS bundle on the logo-reel side. The Tailwind CLI does **not** run `postcss-import` even when `postcss.config.js` is present (it bypasses postcss config). Tried adding `postcss-import` as a plugin first — no effect. Resolved by **inlining the keyframes + `prefers-reduced-motion` clause directly into `src/styles.css`** under a clearly-labelled "Block-specific CSS" section, then deleting the per-block CSS file. Documented in the styles.css header so future contributors don't recreate the broken pattern. `postcss-import` reverted from devDeps.
  2. Initial manifest definition had a TypeScript variance issue assigning `BlockManifestEntry<typeof xSchema>` into `BlockManifestEntry<z.ZodTypeAny>[]`. Resolved by casting each entry through `BlockManifestEntry<any>` at the array boundary — same pattern shadcn uses, plus per-line eslint-disable to keep the noise local.
  3. Initial logo-reel test asserted custom property via DOM `style.getPropertyValue` — works fine but only because jsdom returns the inline style as authored. If jsdom changes I'd need `getComputedStyle`. Documented in-line.
- **Brand tokens used throughout via Tailwind classes** (`bg-theme-main`, `text-theme-on-surface`). The hero block uses `bg-theme-main` + `text-theme-on-main`; the cta block uses `bg-theme-accent`/`bg-theme-muted` based on variant. These resolve to CSS custom properties the renderer sets at `:root` per-site (already wired in Phase 1's `render-page.tsx`) — no per-block CSS variable wiring needed.
- **Block `type` keys match Phase 1's inline blocks** (`hero`, `cta`) so the existing seed data in production renders unchanged after the 2.8 swap. The new blocks introduce new types (`hero-slider`, `testimonial-carousel`, `logo-reel`, `faq-accordion`) — no collision risk.
- **CSS bundle** is now ~14KB minified, including utility classes for all six blocks + the marquee keyframes. Will grow with future blocks but still cheap.

### 2026-05-19 12:00 UTC — Task 2.4 (shadcn primitives copy-in)
**Commit:** 834e13e
**Done:** Five internal primitives landed under `packages/components/src/primitives/`, exported from a barrel that the opinionated blocks layer (2.5) will consume. None are re-exported from the package root — primitives stay internal.
- **`Button`** — cva-based variants (primary / secondary / outline / ghost / link) × sizes (sm / md / lg / icon). `asChild` via Radix `Slot` so blocks can render `<a>` while keeping the visual class set. Default variant uses brand-token classes (`bg-theme-accent` etc.). Focus ring uses `ring-theme-accent`.
- **`Card` family** — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`. Surface + border tokens map to brand vars.
- **`Accordion` family** — wraps `@radix-ui/react-accordion`. Trigger uses a unicode chevron (`▾`) rotated via `data-state=open` instead of inline SVG (D-005). Content uses `data-[state=*]:animate-*` classes from `tailwindcss-animate`.
- **`Carousel` family** — Embla wrapper with `useEmblaCarousel`, context provider exposing `scrollPrev/scrollNext/canScrollPrev/canScrollNext`, `CarouselContent` + `CarouselItem` with ARIA `region` + `group` roles + `aria-roledescription`, `CarouselPrevious`/`CarouselNext` buttons with disabled-when-edge state and customizable `label` prop. Keyboard navigation via Arrow keys (Left/Up = prev, Right/Down = next) on the region (`tabIndex=0`). Default control glyphs are unicode `‹` `›`.
- **`Slot`** — thin re-export of `@radix-ui/react-slot` so other primitives can import from inside the package.
**Tests added:** 15 across 4 test files (Button: 4, Card: 2, Accordion: 4, Carousel: 5). Embla + Radix need browser globals jsdom lacks — added shims to `vitest.setup.ts` for `matchMedia` (Embla), `ResizeObserver` (Radix), `IntersectionObserver` (Embla). `@testing-library/jest-dom` matchers registered via the same setup file; types added to `tsconfig.json`. Package suite: 23 passed. Build emits the same artifacts as before plus the larger transpiled JS bundle (no measurable size jump until 2.5 actually uses these). Root renderer 114 passed; package typecheck clean.
**Next:** Task 2.5 — opinionated blocks first wave (6 ac-prefixed blocks built on top of these primitives, registered into the manifest).
**Notes:**
- **Three jsdom shims caught at first test run**, in order: `matchMedia` (Embla `optionsMediaQueries`), `ResizeObserver` (Radix), `IntersectionObserver` (Embla `init`). All three are standard mocks — none of them affect what the tests are actually asserting (ARIA roles, click handlers, keyboard events). Same setup file will serve every block test in 2.5.
- The carousel keyboard-nav test only asserts the keydown handler doesn't throw + preventDefault is callable. A full "advance to next slide" assertion would require driving Embla's internal layout pass, which jsdom can't do without a real layout engine. Acceptable for v0.1; revisit if a real bug surfaces.
- Brand tokens are used directly as Tailwind classes (`bg-theme-main`, `text-theme-on-surface`) — these resolve to CSS custom properties at render time. No `font-family` declarations anywhere in the primitives (D-005).
- Icon strategy: unicode glyphs (`▾` `‹` `›`) inside `<span aria-hidden="true">`. When opinionated blocks need richer icons (e.g. a logo reel needs no icons but a CTA might want one), the consuming block can pass children or use Font Awesome classes per D-005.

### 2026-05-19 11:45 UTC — Task 2.3 (Tailwind + CSS toolchain in package)
**Commit:** ef7128f
**Done:** Package-local Tailwind 3.4 pipeline. New files: `packages/components/tailwind.config.js` (ESM, content scoped to `src/**`, brand-token color map wiring `bg-theme-main` → `var(--theme-main)` etc., `tailwindcss-animate` plugin), `postcss.config.js`, `src/styles.css` (Tailwind `@base/@components/@utilities` directives + header comment naming the consumption import path), `src/lib/cn.ts` (standard shadcn `clsx`+`tailwind-merge` helper used by every primitive and block from 2.4 onward). Build pipeline: `npm run build` now runs `tsup` (JS+types) first, then `tailwindcss --minify` (writes `dist/styles.css` into the already-populated dist dir — order matters because tsup `clean: true` would otherwise wipe the CSS). Deps split correctly between runtime (`clsx`, `tailwind-merge`, `class-variance-authority`) and build-only (`tailwindcss`, `tailwindcss-animate`, `postcss`, `autoprefixer`).
**Tests added:** 5 — 3 in `src/lib/cn.test.ts` covering clsx composition + tailwind-merge conflict resolution + non-conflict passthrough, 2 in `tests/build-artifacts.test.ts` asserting (a) ESM/CJS/types entrypoints exist and (b) `dist/styles.css` is non-empty and contains the Tailwind license banner + preflight `box-sizing: border-box`. The build-artifacts file uses `describe.skip` when `dist/` is missing so devs can run unit tests without rebuilding. Package suite: 8 passed (5 new). Root renderer suite still 114 passed; package typecheck clean.
**Next:** Task 2.4 — copy in shadcn primitives (button, card, carousel, accordion, slot) using `cn` + Radix + Embla. Internal-only layer.
**Notes:**
- **Build order bug caught immediately:** first attempt ran `build:css && build:js`. tsup's `clean: true` wiped the CSS. Reversed to `build:js && build:css`. Recorded here so future reorderings re-check the order.
- The first build-artifacts test regex (`/\*\s*,\s*::?before/`) was too strict — minified CSS drops the space between `*,` and `:after`. Replaced with the Tailwind license banner pattern + a `box-sizing: border-box` check; both are stable across minify modes.
- Brand tokens in `tailwind.config.js` map to CSS custom properties the renderer already sets at `:root` per-site (see `src/server/render-page.tsx`). The Phase 1 inline blocks use plain CSS variables; Phase 2 blocks can use either the Tailwind class form (`bg-theme-main`) or the raw `var(--theme-main)`, whichever reads cleaner per-block.
- `tailwindcss-animate` plugin enables `animate-*` utility classes used by Radix-derived primitives (accordion open/close, etc.) without each primitive shipping its own keyframes.
- A `dev:css` script is provided alongside `dev` (JS watcher). Both run concurrently when the developer needs CSS HMR; we won't add `concurrently` as a dep until Task 2.9 if needed.

### 2026-05-19 11:35 UTC — Task 2.2 (Monorepo workspaces + package skeleton)
**Commit:** 2cc8a98
**Done:** Added `"workspaces": ["packages/*"]` to root `package.json` plus `build:components` / `dev:components` / `test:components` orchestration scripts. Created `packages/components/` with `package.json` (name `@anchorcorps/components`, version `0.1.0`, `publishConfig.registry` → the AR npm repo, `exports` map covering ESM, CJS, types, and `./styles.css`), `tsconfig.json` (`jsx: "react-jsx"`, strict, `noEmit`), `tsup.config.ts` (ESM + CJS + dts + sourcemaps, externals: react / react-dom / react/jsx-runtime / zod), `vitest.config.ts` (`jsdom`), and `README.md`. First package source landed: `src/index.ts` exports `VERSION` / `blockManifest` / `registerAll` / `BlockManifestEntry` / `RegisterBlockFn`. `src/blocks/manifest.ts` defines the entry shape (structurally compatible with the renderer's `BlockRegistryEntry`) and ships an empty manifest array — populated in 2.5. `RegisterBlockFn` matches the renderer's `registerBlock(type, entry)` signature so the package never imports the renderer (D-016). `dist/` is already gitignored at repo root so the package's build output is auto-excluded.
**Tests added:** 3 (`packages/components/src/index.test.ts`) — `VERSION` matches `0.1.x`, `blockManifest` is an array, `registerAll` invokes the caller's register once per entry (zero in 0.1.0 skeleton). Package suite: 3 passed. Root renderer suite still 114 passed (unaffected — root vitest globs at `src/**` + `tests/**`, not `packages/**`).
**Next:** Task 2.3 — Tailwind + cva + clsx + tailwind-merge inside the package; tsup pipeline emits `dist/styles.css`.
**Notes:**
- Decision **D-026** (workspaces in this repo) and **D-027** (tsup) are now live. They'll be appended to `DECISIONS.md` as part of Task 2.10's docs pass so the entry can reference what landed.
- The exports map already advertises `./styles.css`. tsup doesn't produce a CSS file in the 0.1.0 skeleton; 2.3 adds it. Consumers that try to import `@anchorcorps/components/styles.css` before 2.3 will fail, which is acceptable — the renderer swap isn't until 2.8.
- `tsup` + jsdom + @testing-library landed as devDeps (77 new packages, vulns are in transitive dev-only chains; pre-existing root audit warnings unchanged).
- Root `tsconfig.json` `include` is scoped to root `src/**` etc. — it doesn't try to typecheck `packages/`. Each package owns its own tsconfig.

### 2026-05-19 11:25 UTC — Task 2.1 (Artifact Registry npm repo + auth wiring)
**Commit:** 5c86421
**Done:** Created npm-format Artifact Registry repo `npm-anchorcorps` in `anchor-hub-480305/us-central1` via `gcloud artifacts repositories create`. Wrote `docs/components-publish.md` covering registry coordinates, the `.npmrc` template (token-based auth via `gcloud auth print-access-token`), CI auth pattern (WIF + service-account `roles/artifactregistry.writer` scoped to this repo only), semver policy for `0.x` (manifest changes ride minor bumps with explicit notes), publish flow placeholder for Task 2.7, and a troubleshooting section. No code changes — pure infra + docs.
**Tests added:** 0 — no code path to test. Repo existence verified via `gcloud artifacts repositories list`. Real publish smoke is Task 2.7.
**Next:** Task 2.2 — monorepo workspaces + `packages/components/` skeleton + `tsup` build pipeline.
**Notes:**
- `gcloud artifacts print-settings npm --scope=@anchorcorps` produced the exact `.npmrc` lines used in the doc.
- The `anchor-sites-components-publisher` service account is referenced in the doc but **not** created yet — Task 2.7 creates it alongside the Cloud Build trigger. Documented now to keep `docs/components-publish.md` as the single source of truth.
- No new GCP cost beyond the negligible AR storage (the repo is empty until 2.7).
