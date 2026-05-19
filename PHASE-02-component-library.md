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

- [ ] **2.3 — Tailwind + CSS toolchain inside the package**
  - Package-local `tailwind.config.ts` + `postcss.config.cjs`, content globs scoped to `packages/components/src/**/*.{ts,tsx}`
  - Deps: `tailwindcss`, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge`, `postcss`, `autoprefixer`
  - `tsup.config.ts` injects the Tailwind CSS pipeline; build emits `dist/styles.css` consumers import as a side effect
  - **Tests:** build assertion — `dist/styles.css` exists and contains a known class from the opinionated blocks layer

- [ ] **2.4 — shadcn primitives copy-in (internal layer)**
  - Copy into `packages/components/src/primitives/`: `button`, `card`, `carousel` (Embla), `accordion` (Radix), `slot` (Radix)
  - Deps: `@radix-ui/react-accordion`, `@radix-ui/react-slot`, `embla-carousel-react`, `embla-carousel-autoplay`
  - Primitives are **not** exported from the package root. They are internal building blocks for the opinionated blocks layer.
  - **Tests:** render + a11y attr assertions per primitive; carousel keyboard nav (arrow keys advance); accordion `aria-expanded` toggles

- [ ] **2.5 — Opinionated blocks first wave**
  - **2.5.a** `ac-hero` — direct port of Phase 1 inline `src/blocks/hero` schema (so existing seed renders unchanged)
  - **2.5.b** `ac-hero-slider` — multi-slide Embla, schema `{ slides: Slide[], autoplay?, interval? }`
  - **2.5.c** `ac-cta` — direct port of Phase 1 inline `src/blocks/cta` schema
  - **2.5.d** `ac-testimonial-carousel` — Embla, per-slide `{ quote, author, role?, avatar? }`
  - **2.5.e** `ac-logo-reel` — CSS-marquee logo strip, no JS, schema `{ logos: { src, alt, href? }[] }`
  - **2.5.f** `ac-faq-accordion` — Radix accordion via shadcn, schema `{ items: { question, answer }[] }`
  - Each block ships: `schema.ts`, `component.tsx`, `index.ts` (exports `{ type, schema, component, label, description, aiHints?, category }`), `styles.css` (component-scoped, CSS custom props for colors, no `font-family`)
  - **Tests per block:** schema parses with defaults; component renders with `ac-<name>` root class; brand-token CSS vars referenced

- [ ] **2.6 — Block manifest + registerAll export**
  - `packages/components/src/blocks/manifest.ts` exports `blockManifest: BlockManifestEntry[]` covering every block from 2.5
  - `BlockManifestEntry` shape matches renderer's `BlockRegistryEntry` (so the renderer can register without a shape adapter)
  - Export `registerAll(register: (type, entry) => void)` convenience — the renderer passes its own `registerBlock`; the package never imports the renderer
  - **Tests:** every manifest entry has all required fields; `registerAll` invokes the provided register once per block; every schema accepts its declared defaults

- [ ] **2.7 — Publish workflow + first publish**
  - `packages/components/scripts/publish.sh` — generates a temp `.npmrc` with `gcloud auth print-access-token`, then `npm publish --access=restricted`
  - Cloud Build trigger in `anchor-hub-480305` watching tags `components-v*` on this repo, separate from the renderer trigger
  - Service account `anchor-sites-components-publisher@anchor-hub-480305.iam.gserviceaccount.com` with `roles/artifactregistry.writer` on the npm repo only
  - Document the tag-and-publish flow in `docs/components-publish.md`
  - **Tests:** dry-run publish (`npm publish --dry-run`) added to PR CI; first real publish lands `0.1.0` to the AR repo as a manual smoke

- [ ] **2.8 — Renderer consumption + swap**
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

### 2026-05-19 11:35 UTC — Task 2.2 (Monorepo workspaces + package skeleton)
**Commit:** (pending — same commit as this log entry)
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
