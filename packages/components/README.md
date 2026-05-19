# `@anchorcorps/components`

Versioned global component library for AnchorCorps sites. Ships opinionated `ac-`-prefixed blocks built on shadcn/ui primitives and Embla Carousel. Distributed via GCP Artifact Registry (`anchor-hub-480305 / us-central1 / npm-anchorcorps`).

> See `docs/components-publish.md` at the repo root for registry coordinates, auth, and the publish workflow.

## Install (inside a workspace consumer)

```bash
npm install @anchorcorps/components
```

A project-level `.npmrc` must route the `@anchorcorps` scope at the AR npm registry — see `docs/components-publish.md`.

## Consume

The renderer imports the manifest and registers every entry against its own block registry (D-016):

```ts
import { blockManifest, registerAll } from "@anchorcorps/components";
import "@anchorcorps/components/styles.css";
import { registerBlock } from "./blocks/registry.js";

registerAll(registerBlock);
// or, manually:
for (const entry of blockManifest) {
  const { type, ...rest } = entry;
  registerBlock(type, rest);
}
```

The package never imports the renderer's registry — the renderer supplies its own `registerBlock`. This keeps the package consumable from any future renderer or test harness.

## Package contents (v0.1)

- **Internal primitives** (not exported): shadcn-derived `Button`, `Card`, `Carousel`, `Accordion`, `Slot`.
- **Opinionated blocks** (exported via `blockManifest`):
  - `ac-hero`, `ac-hero-slider`
  - `ac-cta`
  - `ac-testimonial-carousel`
  - `ac-logo-reel`
  - `ac-faq-accordion`

Each block ships a Zod schema, a React component using the `ac-<type>` class, and CSS that consumes brand-token custom properties (`--theme-main`, `--theme-accent`, etc.) — no `font-family` declarations, no embedded SVG icons (Font Awesome via the consumer site).

## Develop

From the repo root (npm workspaces hoist all deps):

```bash
npm install
npm run build:components
npm run dev:components   # tsup --watch
npm run test:components
```

## Publish

See `docs/components-publish.md`.
