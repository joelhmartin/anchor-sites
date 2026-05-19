# Consuming `@anchorcorps/components`

How the renderer (and future provisioned-site templates) wire the package into their block registry. Concise — the package's `README.md` covers install + auth; this doc covers the consumption pattern inside *this* repo.

## TL;DR

Inside this repo, the package is consumed via **npm workspaces** (D-026). The renderer never needs an `.npmrc` because the workspace symlink (`node_modules/@anchorcorps/components → packages/components`) resolves the import locally in both dev and prod.

External consumers (e.g. Phase 8 provisioned-site templates) will install from the AR npm registry following `docs/components-publish.md`.

## Block registration

`src/blocks/index.ts` iterates the package's `blockManifest` and registers every entry with the renderer's own `registerBlock`. The package never imports the renderer's registry (D-016):

```ts
import { blockManifest } from "@anchorcorps/components";
import { registerBlock } from "./registry.js";

for (const entry of blockManifest) {
  const { type, ...rest } = entry;
  registerBlock(type, rest);
}

// Inline blocks (Tiptap deferred to Phase 5) still register the old way.
import "./rich-text/index.js";
```

The renderer's `BlockRenderer` looks blocks up by `type` against `pages.blocks[].type` — same shape Phase 1 used. Existing seed data renders unchanged.

## CSS

The package ships `dist/styles.css` (compiled by Tailwind, see D-028). The renderer reads it once at module-load and inlines the contents into the SSR'd `<style>` tag:

```ts
// src/server/render-page.tsx
const PACKAGE_BLOCK_CSS = tryReadPackageAsset("@anchorcorps/components/styles.css");
// ...
const styles = `:root { ${brandStyle} }${SHELL_BASE_CSS}${PACKAGE_BLOCK_CSS}${RICH_TEXT_CSS}`;
```

`createRequire(import.meta.url).resolve` walks the workspace symlink in dev and the COPY'd `packages/components/dist/styles.css` in prod. Reads are wrapped in `try/catch` so a missing file degrades silently rather than crashing the server.

## Brand tokens

Block components reference brand tokens through Tailwind utility classes (`bg-theme-main`, `text-theme-on-surface`, `border-theme-border`, etc.). Those classes resolve to CSS custom properties the renderer sets at `:root` per-site from `sites.default_brand_tokens`:

```css
:root { --theme-main: #0a3d62; --theme-accent: #f6b93b; }
```

If a per-site brand changes mid-session, the renderer re-issues the page with updated `:root` declarations — no JS, no rerender.

## Deploy

The renderer's Docker image (Phase 1 / Task 1.8) was extended in Phase 2 / Task 2.9 to:
1. Copy `packages/components/package.json` before `npm ci` so npm sees the workspace topology.
2. Run `npm run build:components` (tsup + tailwind) before `npm run build` (vite renderer), so the package's `dist/styles.css` exists by the time `render-page.tsx` reads it.
3. Copy `packages/components/{package.json,dist}` into the final `run` stage so `createRequire` can resolve the package symlink.

No `.npmrc` is needed. No Cloud Build IAM beyond what the renderer already had.

## When to break the workspace pattern

The workspace consumption pattern is the right call while the only consumer is *this* renderer. When a second consumer surfaces (Phase 8 provisioned-site templates), it should consume from the AR npm registry — `docs/components-publish.md` covers the auth + publish flow.

At that point, this renderer can optionally switch to AR-resolved installs too, but doesn't have to. Both patterns are supported by the same package.
